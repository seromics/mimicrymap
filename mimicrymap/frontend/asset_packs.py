"""Read-only packed reference assets. Paths and source hashes stay authoritative."""
import gzip,hashlib,io,json,os,re,sqlite3,threading,zlib
from collections import OrderedDict
from pathlib import Path

FORMAT='seromap.assets/1';APP_ID=0x5341504b;MAX_ENTRY=64*1024*1024
PREFIXES={
 'structures-monomer':('structures/alphafold_monomer/','mimicrymap/reference/alphafold/'),
 'structures-dimer':('structures/dimer/','mimicrymap/bake/out_v2_complete/structures_dimer/'),
 'protein-annotations':('mimicrymap/bake/out_v2_complete/assets/proteins_catalogue/',),
 'viral-images':('reference/legacy_assets/viral_images/',),
 'atlas-results':tuple('mimicrymap/bake/out_v2_complete/'+name+'/' for name in ('collection-protein-surfaces','collection-coverage','collection-sequences')),
}

class AssetPackError(ValueError):pass

def open_database(file,role):
    db=sqlite3.connect(file.resolve().as_uri()+'?mode=ro',uri=True,check_same_thread=False)
    try:
        db.execute('PRAGMA query_only=ON');db.execute('PRAGMA cache_size=-2048')
        meta=dict(db.execute('SELECT key,value FROM metadata'))
        if db.execute('PRAGMA application_id').fetchone()[0]!=APP_ID or db.execute('PRAGMA user_version').fetchone()[0]!=1 or meta.get('format')!=FORMAT or meta.get('role')!=role:raise AssetPackError('Unsupported asset database')
        return db,meta
    except BaseException:db.close();raise

class AssetPack:
    def __init__(self,directory,namespace,required=False):
        self.directory=Path(directory);self.namespace=namespace;self.required=required;self.index=None;self.shards=OrderedDict();self.lock=threading.RLock();self.roots=set()
    @property
    def installed(self):return self.required or (self.directory/'index.sqlite').is_file()
    def open(self):
        if self.index is None:
            db,meta=open_database(self.directory/'index.sqlite','index')
            if meta.get('namespace')!=self.namespace:db.close();raise AssetPackError('Wrong asset namespace')
            self.roots=set(json.loads(meta['roots']));self.index=db
    def supports_root(self,relative):
        if not self.installed:return False
        try:
            with self.lock:self.open();return relative.rstrip('/') in self.roots
        except (OSError,sqlite3.Error,ValueError,KeyError,TypeError) as error:
            raise AssetPackError('Reference asset pack is invalid; repair its module in Modules.') from error
    def get(self,relative,expected_sha256=None):
        try:
            with self.lock:
                self.open()
                row=self.index.execute('SELECT sha256,bytes,shard FROM aliases WHERE path=?',(relative,)).fetchone()
                if row is None and os.name=='nt':row=self.index.execute('SELECT sha256,bytes,shard FROM aliases WHERE path=? COLLATE NOCASE',(relative,)).fetchone()
                if row is None:return None
                digest,size,name=row
                if expected_sha256 is not None and digest!=expected_sha256:raise AssetPackError('Asset identity differs from pinned release')
                if not re.fullmatch(r'[0-9a-f]{2}-[0-9a-f]{64}\.sqlite',name) or type(size) is not int or not 0<=size<=MAX_ENTRY:raise AssetPackError('Invalid asset record')
                if name not in self.shards:
                    file=self.directory/name
                    if file.resolve().parent!=self.directory.resolve():raise AssetPackError('Asset shard escapes pack')
                    self.shards[name]=open_database(file,'payload')[0]
                self.shards.move_to_end(name)
                while len(self.shards)>4:self.shards.popitem(last=False)[1].close()
                payload=self.shards[name].execute('SELECT bytes,gzip FROM blobs WHERE sha256=?',(digest,)).fetchone()
                if payload is None or payload[0]!=size:raise AssetPackError('Missing asset payload')
            with gzip.GzipFile(fileobj=io.BytesIO(payload[1])) as stream:data=stream.read(size+1)
            if len(data)!=size or hashlib.sha256(data).hexdigest()!=digest:raise AssetPackError('Asset checksum differs')
            return {'data':data,'sha256':digest}
        except (OSError,sqlite3.Error,ValueError,KeyError,TypeError,EOFError,zlib.error) as error:
            raise AssetPackError('Reference asset pack is invalid; repair its module in Modules.') from error
    def close(self):
        with self.lock:
            if self.index:self.index.close();self.index=None
            for db in self.shards.values():db.close()
            self.shards.clear()

class AssetLibrary:
    def __init__(self,root):
        self.root=Path(root).resolve()
        manifest=self.root/'modules.json'
        installed={m['id']:m for m in json.loads(manifest.read_text())['installed']} if manifest.is_file() else {}
        owners={'structures-monomer':'structures-monomer','structures-dimer':'structures-dimer','protein-annotations':'mimicry-core','viral-images':'reference-lookups','atlas-results':'mimicry-atlas-assets'}
        self.packs={key:AssetPack(self.root/'asset-packs'/key,key,bool(installed.get(owners[key],{}).get('assetFormat'))) for key in PREFIXES}
    def relative(self,path):
        try:return Path(path).resolve().relative_to(self.root).as_posix()
        except ValueError:return None
    def owner(self,path):
        relative=self.relative(path)
        if relative is None:return None
        for key,prefixes in PREFIXES.items():
            if any(relative.startswith(prefix) for prefix in prefixes) and self.packs[key].installed:return self.packs[key]
        return None
    def supports_root(self,path):
        relative=self.relative(path)
        if relative is None:return False
        for key,prefixes in PREFIXES.items():
            if any((relative.rstrip('/')+'/').startswith(prefix) for prefix in prefixes):return self.packs[key].supports_root(relative)
        return False
    def close(self):
        for pack in self.packs.values():pack.close()
