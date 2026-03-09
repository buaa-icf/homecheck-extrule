#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith('--')) {
      continue;
    }
    const eqIndex = item.indexOf('=');
    if (eqIndex === -1) {
      args[item.slice(2)] = 'true';
      continue;
    }
    const key = item.slice(2, eqIndex);
    const value = item.slice(eqIndex + 1);
    args[key] = value;
  }
  return args;
}

function readJson(jsonPath) {
  const content = fs.readFileSync(jsonPath, 'utf8');
  return JSON.parse(content);
}

function ensureTrailingSeparator(targetPath) {
  return targetPath.endsWith(path.sep) ? targetPath : `${targetPath}${path.sep}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toSafeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function printUsage() {
  console.log('Usage: node ./scripts/batchScanRepos.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --reposRoot=<abs_path>         Root directory containing repositories');
  console.log('  --baseProjectConfig=<path>     Base projectConfig.json path');
  console.log('  --ruleConfig=<path>            Rule config path');
  console.log('  --runnerPath=<path>            homecheck runner JS path');
  console.log('  --issuesReportPath=<path>      Generated issuesReport path');
  console.log('  --outputDir=<path>             Output root for saved reports');
  console.log('  --npmCacheDir=<path>           npm cache dir used during scans');
  console.log('  --includeRepos=a,b,c           Only scan these repo names');
  console.log('  --includeHidden=true           Include hidden directories (default false)');
  console.log('  --maxRepos=<n>                 Scan at most N repositories');
  console.log('  --stopOnError=true             Stop at first failed repository');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true') {
    printUsage();
    return;
  }

  const cwd = process.cwd();
  const reposRoot = path.resolve(
    cwd,
    args.reposRoot || '/Users/jiaomingyang/project/arkts/repos'
  );
  const baseProjectConfigPath = path.resolve(
    cwd,
    args.baseProjectConfig || './config/projectConfig.json'
  );
  const ruleConfigPath = path.resolve(cwd, args.ruleConfig || './config/ruleConfig.json');
  const runnerPath = path.resolve(cwd, args.runnerPath || './node_modules/homecheck/lib/run.js');
  const issuesReportPath = path.resolve(cwd, args.issuesReportPath || './report/issuesReport.json');
  const outputDir = path.resolve(cwd, args.outputDir || './report/batchIssuesReports');
  const tmpConfigDir = path.resolve(cwd, './report/.tmp');
  const npmCacheDir = path.resolve(cwd, args.npmCacheDir || './report/.npm-cache');
  const includeRepos = args.includeRepos ? new Set(args.includeRepos.split(',').filter(Boolean)) : null;
  const includeHidden = args.includeHidden === 'true';
  const maxRepos = args.maxRepos ? Number(args.maxRepos) : null;
  const stopOnError = args.stopOnError === 'true';

  if (!fs.existsSync(reposRoot)) {
    throw new Error(`reposRoot does not exist: ${reposRoot}`);
  }
  if (!fs.existsSync(baseProjectConfigPath)) {
    throw new Error(`baseProjectConfig does not exist: ${baseProjectConfigPath}`);
  }
  if (!fs.existsSync(ruleConfigPath)) {
    throw new Error(`ruleConfig does not exist: ${ruleConfigPath}`);
  }
  if (!fs.existsSync(runnerPath)) {
    throw new Error(`runnerPath does not exist: ${runnerPath}`);
  }
  if (maxRepos !== null && (!Number.isFinite(maxRepos) || maxRepos <= 0)) {
    throw new Error(`maxRepos should be a positive number, got: ${args.maxRepos}`);
  }

  const baseProjectConfig = readJson(baseProjectConfigPath);
  let repoNames = fs
    .readdirSync(reposRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && (includeHidden || !entry.name.startsWith('.')))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (includeRepos) {
    repoNames = repoNames.filter((name) => includeRepos.has(name));
  }
  if (maxRepos !== null) {
    repoNames = repoNames.slice(0, maxRepos);
  }

  ensureDir(outputDir);
  ensureDir(tmpConfigDir);
  ensureDir(npmCacheDir);

  const startedAt = new Date().toISOString();
  const summary = {
    startedAt,
    reposRoot,
    totalRepos: repoNames.length,
    outputDir,
    runnerPath,
    ruleConfigPath,
    items: []
  };

  if (repoNames.length === 0) {
    const summaryPath = path.join(outputDir, 'summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`No repositories found to scan. Summary saved: ${summaryPath}`);
    return;
  }

  console.log(`Found ${repoNames.length} repositories under: ${reposRoot}`);

  for (let i = 0; i < repoNames.length; i += 1) {
    const repoName = repoNames[i];
    const repoPath = path.join(reposRoot, repoName);
    const repoStart = Date.now();
    const tempConfigPath = path.join(tmpConfigDir, `projectConfig.${toSafeFileName(repoName)}.json`);
    const savedReportPath = path.join(outputDir, repoName, 'issuesReport.json');

    const projectConfig = {
      ...baseProjectConfig,
      projectName: repoName,
      projectPath: ensureTrailingSeparator(path.resolve(repoPath))
    };

    ensureDir(path.dirname(savedReportPath));
    fs.writeFileSync(tempConfigPath, JSON.stringify(projectConfig, null, 2));

    console.log(`[${i + 1}/${repoNames.length}] scanning: ${repoName}`);

    // Avoid copying stale report from previous runs.
    fs.rmSync(issuesReportPath, { force: true });

    const runResult = spawnSync(
      'node',
      [
        runnerPath,
        `--projectConfigPath=${tempConfigPath}`,
        `--configPath=${ruleConfigPath}`
      ],
      {
        cwd,
        stdio: 'inherit',
        env: {
          ...process.env,
          npm_config_cache: npmCacheDir,
          NPM_CONFIG_CACHE: npmCacheDir
        }
      }
    );

    let copied = false;
    if (fs.existsSync(issuesReportPath)) {
      fs.copyFileSync(issuesReportPath, savedReportPath);
      copied = true;
    }

    const durationMs = Date.now() - repoStart;
    const success = runResult.status === 0 && copied;
    const item = {
      repoName,
      repoPath,
      success,
      exitCode: runResult.status,
      signal: runResult.signal,
      copied,
      savedReportPath,
      durationMs
    };
    summary.items.push(item);

    if (success) {
      console.log(`  done (${durationMs}ms), report: ${savedReportPath}`);
    } else {
      console.log(`  failed (${durationMs}ms), exitCode=${runResult.status}, copied=${copied}`);
      if (stopOnError) {
        console.log('stopOnError=true, aborting.');
        break;
      }
    }
  }

  summary.finishedAt = new Date().toISOString();
  summary.successCount = summary.items.filter((item) => item.success).length;
  summary.failureCount = summary.items.length - summary.successCount;
  const summaryPath = path.join(outputDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log('');
  console.log(`Batch scan finished. Success=${summary.successCount}, Failed=${summary.failureCount}`);
  console.log(`Summary: ${summaryPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
}
