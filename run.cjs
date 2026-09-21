#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const packaged=path.join(__dirname,'code/pipeline-runner.cjs');
const runner=fs.existsSync(packaged)?packaged:path.join(__dirname,'../frontend/reproduce/pipeline-runner.cjs');
const args=process.argv.slice(2);
if(args.length&&args[0]!=='--help'){console.error('Run node run.cjs with no arguments. Edit settings.json to change the inputs, threshold, selected start or output folder.');process.exitCode=1;}
else {const result=cp.spawnSync(process.execPath,[runner,...(args[0]==='--help'?['--help']:[path.join(__dirname,'settings.json')])],{stdio:'inherit'});if(result.error)console.error(result.error.message);process.exitCode=result.status??1;}
