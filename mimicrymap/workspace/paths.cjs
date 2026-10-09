const path = require('node:path');
const fs = require('node:fs');
function fileLabel(value, limit = 60) {
  let name = String(value || 'Library').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, limit).replace(/[. ]+$/g, '') || 'Library';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}
function comparisonLabel(c) {
  const product = c.complete ? (c.retainsPositions === false ? 'candidate index' : 'full lookup') : `target ${c.targetId}`;
  return `${fileLabel(c.target.name, 45)} to ${fileLabel(c.parent.name, 45)} - ${c.floor}of9 - ${product}`;
}
function comparisonDirectory(root, c) {
  if (!/^[a-z0-9-]{1,100}$/i.test(c?.id || '')) throw Error('Invalid comparison identifier');
  const base = path.resolve(root, 'Comparisons');
  const folder = c.folder || c.id;
  if (folder !== path.basename(folder) || /[<>:"/\\|?*\x00-\x1f]/.test(folder) || /^[. ]+$/.test(folder)) throw Error('Invalid comparison folder');
  const destination = path.resolve(base, folder);
  if (!destination.startsWith(base + path.sep)) throw Error('Invalid comparison folder');
  // A rename interrupted after recording its destination resumes from the old ID.
  const legacy = path.join(base, c.id);
  return c.folder && !fs.existsSync(destination) && fs.existsSync(legacy) ? legacy : destination;
}
module.exports = { comparisonLabel, comparisonDirectory };
