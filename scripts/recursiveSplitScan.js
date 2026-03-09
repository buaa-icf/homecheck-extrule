#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith("--")) {
      continue;
    }
    const eqIndex = item.indexOf("=");
    if (eqIndex === -1) {
      args[item.slice(2)] = "true";
      continue;
    }
    const key = item.slice(2, eqIndex);
    const value = item.slice(eqIndex + 1);
    args[key] = value;
  }
  return args;
}

function readJson(jsonPath) {
  return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureTrailingSeparator(targetPath) {
  return targetPath.endsWith(path.sep)
    ? targetPath
    : `${targetPath}${path.sep}`;
}

function toSafeName(value) {
  return value.replace(/[^a-zA-Z0-9._/-]/g, "_");
}

function listChildDirs(targetPath) {
  return fs
    .readdirSync(targetPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."))
    .filter((name) => name !== "node_modules" && name !== "oh_modules")
    .sort((a, b) => a.localeCompare(b));
}

function printUsage() {
  console.log("Usage: node ./scripts/recursiveSplitScan.js [options]");
  console.log("");
  console.log("Options:");
  console.log(
    "  --reposRoot=<abs_path>         Root directory containing repositories",
  );
  console.log("  --projects=a,b,c               Project names under reposRoot");
  console.log("  --baseProjectConfig=<path>     Base projectConfig.json path");
  console.log("  --ruleConfig=<path>            Rule config path");
  console.log("  --runnerPath=<path>            homecheck runner JS path");
  console.log("  --issuesReportPath=<path>      Generated issuesReport path");
  console.log("  --outputDir=<path>             Output root");
  console.log(
    "  --splitThresholdMs=<n>         Split when duration exceeds threshold",
  );
  console.log(
    "  --maxScanMs=<n>                Max time for each scan (timeout)",
  );
  console.log(
    "  --maxDepth=<n>                 Max split depth, 0 means unlimited",
  );
  console.log(
    "  --npmCacheDir=<path>           npm cache dir used during scans",
  );
}

function writeMergedIssues(leafSuccesses, mergedPath) {
  const fd = fs.openSync(mergedPath, "w");
  fs.writeSync(fd, "[");
  let isFirst = true;
  let totalIssues = 0;
  for (const item of leafSuccesses) {
    const reportData = readJson(item.savedReportPath);
    const issueList = Array.isArray(reportData) ? reportData : [];
    totalIssues += issueList.length;
    for (const issue of issueList) {
      if (!isFirst) {
        fs.writeSync(fd, ",\n");
      }
      fs.writeSync(fd, JSON.stringify(issue));
      isFirst = false;
    }
  }
  fs.writeSync(fd, "]");
  fs.closeSync(fd);
  return totalIssues;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    printUsage();
    return;
  }

  const cwd = process.cwd();
  const reposRoot = path.resolve(
    cwd,
    args.reposRoot || "/Users/jiaomingyang/project/arkts/repos",
  );
  const projects = (args.projects || "ostest_integration_test,samples,xts_acts")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const baseProjectConfigPath = path.resolve(
    cwd,
    args.baseProjectConfig || "./config/projectConfig.json",
  );
  const ruleConfigPath = path.resolve(
    cwd,
    args.ruleConfig || "./config/ruleConfig.json",
  );
  const runnerPath = path.resolve(
    cwd,
    args.runnerPath || "./node_modules/homecheck/lib/run.js",
  );
  const issuesReportPath = path.resolve(
    cwd,
    args.issuesReportPath || "./report/issuesReport.json",
  );
  const outputDir = path.resolve(
    cwd,
    args.outputDir || "./report/recursiveSplitScans",
  );
  const splitThresholdMs = args.splitThresholdMs
    ? Number(args.splitThresholdMs)
    : 120000;
  const maxScanMs = args.maxScanMs ? Number(args.maxScanMs) : 180000;
  const maxDepth = args.maxDepth ? Number(args.maxDepth) : 0;
  const unlimitedDepth = maxDepth === 0;
  const npmCacheDir = path.resolve(
    cwd,
    args.npmCacheDir || "./report/.npm-cache",
  );
  const tmpConfigDir = path.resolve(cwd, "./report/.tmp");

  if (!fs.existsSync(reposRoot)) {
    throw new Error(`reposRoot does not exist: ${reposRoot}`);
  }
  if (!fs.existsSync(baseProjectConfigPath)) {
    throw new Error(
      `baseProjectConfig does not exist: ${baseProjectConfigPath}`,
    );
  }
  if (!fs.existsSync(ruleConfigPath)) {
    throw new Error(`ruleConfig does not exist: ${ruleConfigPath}`);
  }
  if (!fs.existsSync(runnerPath)) {
    throw new Error(`runnerPath does not exist: ${runnerPath}`);
  }
  if (!Number.isFinite(splitThresholdMs) || splitThresholdMs <= 0) {
    throw new Error(
      `splitThresholdMs should be a positive number, got: ${args.splitThresholdMs}`,
    );
  }
  if (!Number.isFinite(maxScanMs) || maxScanMs <= 0) {
    throw new Error(
      `maxScanMs should be a positive number, got: ${args.maxScanMs}`,
    );
  }
  if (!Number.isFinite(maxDepth) || maxDepth < 0) {
    throw new Error(
      `maxDepth should be a non-negative number, got: ${args.maxDepth}`,
    );
  }

  ensureDir(outputDir);
  ensureDir(npmCacheDir);
  ensureDir(tmpConfigDir);

  const baseProjectConfig = readJson(baseProjectConfigPath);
  const startedAt = new Date().toISOString();
  const attempts = [];
  const leaves = [];
  const queue = [];

  for (const project of projects) {
    const projectRoot = path.resolve(reposRoot, project);
    if (!fs.existsSync(projectRoot)) {
      attempts.push({
        project,
        relPath: "",
        targetPath: projectRoot,
        depth: 0,
        success: false,
        skipped: true,
        reason: "project_not_found",
      });
      continue;
    }
    const children = listChildDirs(projectRoot);
    if (children.length === 0) {
      attempts.push({
        project,
        relPath: "",
        targetPath: projectRoot,
        depth: 0,
        success: false,
        skipped: true,
        reason: "no_subdirs",
      });
      continue;
    }
    for (const child of children) {
      queue.push({
        project,
        projectRoot,
        relPath: child,
        targetPath: path.join(projectRoot, child),
        depth: 1,
      });
    }
  }

  console.log(
    `Split scan started. Projects=${projects.length}, initial tasks=${queue.length}, threshold=${splitThresholdMs}ms, timeout=${maxScanMs}ms, maxDepth=${unlimitedDepth ? "unlimited" : maxDepth}`,
  );

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const task = queue[cursor];
    const progress = `${cursor + 1}/${queue.length}`;
    const reportDir = path.join(outputDir, task.project, task.relPath);
    const savedReportPath = path.join(reportDir, "issuesReport.json");
    const safeRel = toSafeName(task.relPath).replace(/\//g, "__");
    const tempConfigPath = path.join(
      tmpConfigDir,
      `projectConfig.split.${toSafeName(task.project)}.${safeRel}.json`,
    );
    const scanProjectName = `${task.project}__${safeRel}`;

    ensureDir(reportDir);

    const scanProjectConfig = {
      ...baseProjectConfig,
      projectName: scanProjectName,
      projectPath: ensureTrailingSeparator(task.targetPath),
    };
    fs.writeFileSync(
      tempConfigPath,
      JSON.stringify(scanProjectConfig, null, 2),
    );

    console.log(`[${progress}] scanning: ${task.project}/${task.relPath}`);

    fs.rmSync(issuesReportPath, { force: true });
    const scanStart = Date.now();
    const runResult = spawnSync(
      "node",
      [
        runnerPath,
        `--projectConfigPath=${tempConfigPath}`,
        `--configPath=${ruleConfigPath}`,
      ],
      {
        cwd,
        stdio: "inherit",
        timeout: maxScanMs,
        killSignal: "SIGKILL",
        env: {
          ...process.env,
          npm_config_cache: npmCacheDir,
          NPM_CONFIG_CACHE: npmCacheDir,
        },
      },
    );
    const durationMs = Date.now() - scanStart;

    let copied = false;
    if (fs.existsSync(issuesReportPath)) {
      fs.copyFileSync(issuesReportPath, savedReportPath);
      copied = true;
    }

    const timedOut = Boolean(
      runResult.error && runResult.error.code === "ETIMEDOUT",
    );
    const success = runResult.status === 0 && copied && !timedOut;
    const canSplitFurther = unlimitedDepth || task.depth < maxDepth;
    const childDirs = canSplitFurther ? listChildDirs(task.targetPath) : [];
    const splitReasons = [];
    if (timedOut) {
      splitReasons.push("timeout");
    }
    if (!success) {
      splitReasons.push("failed");
    }
    if (durationMs > splitThresholdMs) {
      splitReasons.push("slow");
    }

    const shouldSplit =
      childDirs.length > 0 && canSplitFurther && splitReasons.length > 0;

    const attempt = {
      project: task.project,
      relPath: task.relPath,
      targetPath: task.targetPath,
      depth: task.depth,
      success,
      timedOut,
      exitCode: runResult.status,
      signal: runResult.signal,
      copied,
      durationMs,
      childDirCount: childDirs.length,
      split: shouldSplit,
      splitReasons,
      savedReportPath,
    };
    attempts.push(attempt);

    if (shouldSplit) {
      if (copied && fs.existsSync(savedReportPath)) {
        fs.rmSync(savedReportPath, { force: true });
        attempt.copied = false;
      }
      for (const child of childDirs) {
        const childRelPath = path.join(task.relPath, child);
        queue.push({
          project: task.project,
          projectRoot: task.projectRoot,
          relPath: childRelPath,
          targetPath: path.join(task.targetPath, child),
          depth: task.depth + 1,
        });
      }
      console.log(
        `  split (${splitReasons.join("+")}), enqueue ${childDirs.length} children (depth ${task.depth + 1})`,
      );
      continue;
    }

    leaves.push(attempt);
    if (success) {
      console.log(`  done (${durationMs}ms), report: ${savedReportPath}`);
    } else {
      console.log(
        `  failed (${durationMs}ms), exitCode=${runResult.status}, copied=${copied}, timeout=${timedOut}`,
      );
    }
  }

  const leafSuccesses = leaves.filter(
    (item) => item.success && fs.existsSync(item.savedReportPath),
  );
  const mergedIssuesPath = path.join(outputDir, "mergedIssuesReport.json");
  const totalIssueCount = writeMergedIssues(leafSuccesses, mergedIssuesPath);

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    reposRoot,
    projects,
    splitThresholdMs,
    maxScanMs,
    maxDepth,
    unlimitedDepth,
    outputDir,
    totalAttempts: attempts.length,
    totalLeaves: leaves.length,
    leafSuccessCount: leafSuccesses.length,
    leafFailureCount: leaves.length - leafSuccesses.length,
    totalMergedIssues: totalIssueCount,
    mergedIssuesPath,
    attempts,
    leaves,
  };
  const summaryPath = path.join(outputDir, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log("");
  console.log(
    `Split scan finished. Attempts=${summary.totalAttempts}, Leaves=${summary.totalLeaves}, Success=${summary.leafSuccessCount}, Failed=${summary.leafFailureCount}`,
  );
  console.log(`Merged issues: ${mergedIssuesPath} (count=${totalIssueCount})`);
  console.log(`Summary: ${summaryPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
}
