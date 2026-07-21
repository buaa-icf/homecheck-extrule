#!/usr/bin/env node

/**
 * 数据集 F1 评估：把检测结果与 arkts-code-smell 数据集的标注对比。
 *
 * 口径（与团队确认）：
 * - 各仓库按 HEAD 扫描，不逐 commit 固定；行号漂移靠 range 包含匹配容忍。
 * - FP 只在正负例标注覆盖的文件集合内统计，集合外文件的告警不参与。
 * - 匹配规则：检测行落在标注 [rangeStart, rangeEnd] 内，或两者 range 重叠；
 *   code-clone 额外从 message 文本解析第二个片段作为候选位置。
 *
 * 本模块只包含纯函数，不碰进程、网络与控制流，方便单测。
 */

const fs = require('node:fs');
const path = require('node:path');

const DATASET_REPO_URL_TEMPLATE = 'https://github.com/buaa-icf/{name}.git';
const KNOWN_DATASET_REPOS = [
  'agc-template-market-harmonyos-demos',
  'applications_photos',
  'applications_settings',
  'cases',
  'model-evaluation-testsuite',
  'openharmony_tpc_samples',
  'ostest_integration_test',
];

/** code-clone message 形如：...: File.ets:21-39 is similar to /abs/path/File.ets:21-39. (...) */
const CLONE_FRAGMENT_PATTERN = /([^\s]+\.ets)(?:\s*>\s*[^:]+)?:(\d+)-(\d+)\s+is similar to\s+([^\s]+\.ets)(?:\s*>\s*[^:]+)?:(\d+)-(\d+)/;

/** 引号感知的最小 CSV 解析，返回字符串二维数组（含表头行）。 */
function parseCsvRows(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') {
        rows.push(row);
      }
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 'repoName/dir/file.ets' → { repo, relFile }；无法拆分时返回 null。 */
function splitRepoRelFile(sourceFile) {
  const normalized = String(sourceFile || '').replace(/\\/g, '/');
  for (const repo of KNOWN_DATASET_REPOS) {
    if (normalized === repo) {
      return null;
    }
    const repoPrefix = `${repo}/`;
    const index = normalized.indexOf(repoPrefix);
    if (index !== -1) {
      return {
        repo,
        relFile: normalized.slice(index + repoPrefix.length),
      };
    }
  }
  const separatorIndex = normalized.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) {
    return null;
  }
  return {
    repo: normalized.slice(0, separatorIndex),
    relFile: normalized.slice(separatorIndex + 1),
  };
}

function toFiniteLine(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function readJsonArray(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadJsonTargetsFromDir(targets, baseDir, wantedRules, kind) {
  if (!fs.existsSync(baseDir)) {
    return;
  }
  for (const fileName of fs.readdirSync(baseDir).sort()) {
    if (!/\.json$/.test(fileName)) {
      continue;
    }
    for (const item of readJsonArray(path.join(baseDir, fileName))) {
      const split = splitRepoRelFile(item && item.filePath);
      if (!split || !item || !Array.isArray(item.messages)) {
        continue;
      }
      for (const message of item.messages) {
        if (!message || !wantedRules.has(message.rule)) {
          continue;
        }
        const rangeStart = toFiniteLine(message.rangeStart ?? message.line);
        const rangeEnd = toFiniteLine(message.rangeEnd ?? message.line);
        if (rangeStart === null || rangeEnd === null) {
          continue;
        }
        targets.push({
          kind,
          rule: message.rule,
          repo: split.repo,
          relFile: split.relFile,
          rangeStart,
          rangeEnd,
          commitId: null,
        });
      }
    }
  }
}

/**
 * 加载数据集标注。
 * @param {string} datasetDir arkts-code-smell/dataset 目录
 * @param {string[]} ruleNames 参与评测的规则全名（Data Clumps 等不在其中的会被过滤）
 * @returns {{ positives: object[], negatives: object[], repoNames: string[], labeledFilesByRepo: Map<string, Set<string>> }}
 */
function loadGroundTruth(datasetDir, ruleNames) {
  const wantedRules = new Set(ruleNames);
  const positives = [];
  const negatives = [];

  loadJsonTargetsFromDir(
    positives,
    path.join(datasetDir, 'positive', 'local-test'),
    wantedRules,
    'positive',
  );
  loadJsonTargetsFromDir(
    positives,
    path.join(datasetDir, 'positive', 'instrument-test'),
    wantedRules,
    'positive',
  );

  const negativeDir = path.join(datasetDir, 'negative');
  if (fs.existsSync(negativeDir)) {
    for (const fileName of fs.readdirSync(negativeDir).sort()) {
      if (!/^negative-.*\.json$/.test(fileName)) {
        continue;
      }
      for (const item of readJsonArray(path.join(negativeDir, fileName))) {
        const split = splitRepoRelFile(item && item.filePath);
        if (!split || !item || !Array.isArray(item.messages)) {
          continue;
        }
        for (const message of item.messages) {
          if (!message || !wantedRules.has(message.rule)) {
            continue;
          }
          const rangeStart = toFiniteLine(message.rangeStart ?? message.line);
          const rangeEnd = toFiniteLine(message.rangeEnd ?? message.line);
          if (rangeStart === null || rangeEnd === null) {
            continue;
          }
          negatives.push({
            kind: 'negative',
            rule: message.rule,
            repo: split.repo,
            relFile: split.relFile,
            rangeStart,
            rangeEnd,
            commitId: null,
          });
        }
      }
    }
  }

  const labeledFilesByRepo = new Map();
  for (const target of [...positives, ...negatives]) {
    if (!labeledFilesByRepo.has(target.repo)) {
      labeledFilesByRepo.set(target.repo, new Set());
    }
    labeledFilesByRepo.get(target.repo).add(target.relFile);
  }
  return {
    positives,
    negatives,
    repoNames: [...labeledFilesByRepo.keys()].sort(),
    labeledFilesByRepo,
  };
}

function buildDatasetRepos(repoNames) {
  return repoNames.map((name) => ({
    name,
    url: DATASET_REPO_URL_TEMPLATE.replace('{name}', name),
  }));
}

/** 绝对路径 → 仓库内相对路径（统一 / 分隔符）。 */
function toRepoRelative(filePath, repoPath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  let prefix = String(repoPath || '').replace(/\\/g, '/');
  if (prefix && !prefix.endsWith('/')) {
    prefix += '/';
  }
  return prefix && normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : normalized;
}

/** clone message 里的裸文件名归属 issue 所在文件目录；带路径的保持原样。 */
function resolveFragmentFile(fragmentPath, issueRelFile) {
  if (fragmentPath.includes('/')) {
    return fragmentPath;
  }
  const lastSeparator = issueRelFile.lastIndexOf('/');
  return lastSeparator > 0
    ? `${issueRelFile.slice(0, lastSeparator)}/${fragmentPath}`
    : fragmentPath;
}

/**
 * 提取一条检测告警的所有候选位置。
 * 主位置来自结构化字段（无 rangeStart/rangeEnd 时退化为 line）；
 * code-clone 再从 message 文本解析两个片段位置。
 */
function extractDetectionLocations(issue, message, repoPath) {
  const issueRelFile = toRepoRelative(issue && issue.filePath, repoPath);
  const line = toFiniteLine(message && message.line) || 0;
  const locations = [{
    relFile: issueRelFile,
    line,
    rangeStart: toFiniteLine(message && message.rangeStart) ?? line,
    rangeEnd: toFiniteLine(message && message.rangeEnd) ?? line,
  }];
  const cloneMatch = CLONE_FRAGMENT_PATTERN.exec(String((message && message.message) || ''));
  if (cloneMatch) {
    locations.push({
      relFile: resolveFragmentFile(toRepoRelative(cloneMatch[1], repoPath), issueRelFile),
      line: Number(cloneMatch[2]),
      rangeStart: Number(cloneMatch[2]),
      rangeEnd: Number(cloneMatch[3]),
    });
    locations.push({
      relFile: resolveFragmentFile(toRepoRelative(cloneMatch[4], repoPath), issueRelFile),
      line: Number(cloneMatch[5]),
      rangeStart: Number(cloneMatch[5]),
      rangeEnd: Number(cloneMatch[6]),
    });
  }
  return locations;
}

/** 检测位置与标注目标是否匹配：同文件且（行在目标范围内 或 范围重叠）。 */
function locationMatches(location, target) {
  if (location.relFile !== target.relFile) {
    return false;
  }
  const lineInRange = location.line >= target.rangeStart && location.line <= target.rangeEnd;
  const rangesOverlap = location.rangeStart <= target.rangeEnd && target.rangeStart <= location.rangeEnd;
  return lineInRange || rangesOverlap;
}

/**
 * 单仓库对比。
 * @returns {{ [ruleName: string]: { tp: number, fp: number, fn: number, tpList: object[], fpList: object[], fnList: object[] } }}
 */
function compareRepo(options) {
  const { issues, repoName, repoPath, targets, labeledFiles, ruleNames } = options;
  const repoTargets = targets.filter((target) => target.repo === repoName);
  const rules = {};
  for (const ruleName of ruleNames) {
    const positiveTargets = repoTargets.filter(
      (target) => target.rule === ruleName && target.kind === 'positive',
    );
    const negativeTargets = repoTargets.filter(
      (target) => target.rule === ruleName && target.kind === 'negative',
    );
    const detections = [];
    for (const issue of Array.isArray(issues) ? issues : []) {
      if (!issue || !Array.isArray(issue.messages)) {
        continue;
      }
      const relFile = toRepoRelative(issue.filePath, repoPath);
      if (!labeledFiles.has(relFile)) {
        continue;
      }
      for (const message of issue.messages) {
        if (message && message.rule === ruleName) {
          detections.push({
            relFile,
            message,
            locations: extractDetectionLocations(issue, message, repoPath),
          });
        }
      }
    }

    const matchedTargetIndexes = new Set();
    const tpList = [];
    const fpList = [];
    for (const detection of detections) {
      const matchedIndex = positiveTargets.findIndex((target) =>
        detection.locations.some((location) => locationMatches(location, target)),
      );
      if (matchedIndex === -1) {
        const matchedNegative = negativeTargets.find((target) =>
          detection.locations.some((location) => locationMatches(location, target)),
        );
        if (matchedNegative) {
          fpList.push({
            file: detection.relFile,
            line: detection.message.line,
            rangeStart: matchedNegative.rangeStart,
            rangeEnd: matchedNegative.rangeEnd,
            message: detection.message.message,
          });
        }
      } else if (!matchedTargetIndexes.has(matchedIndex)) {
        matchedTargetIndexes.add(matchedIndex);
        tpList.push({
          file: detection.relFile,
          line: detection.message.line,
          rangeStart: positiveTargets[matchedIndex].rangeStart,
          rangeEnd: positiveTargets[matchedIndex].rangeEnd,
        });
      }
    }
    const fnList = positiveTargets
      .filter((_, index) => !matchedTargetIndexes.has(index))
      .map((target) => ({
        file: target.relFile,
        rangeStart: target.rangeStart,
        rangeEnd: target.rangeEnd,
      }));
    rules[ruleName] = {
      tp: tpList.length,
      fp: fpList.length,
      fn: fnList.length,
      tpList,
      fpList,
      fnList,
    };
  }
  return rules;
}

function computeMetrics(counts) {
  const { tp, fp, fn } = counts;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;
  return { precision, recall, f1 };
}

/**
 * 跨仓库聚合。
 * @param {Array<{ repoName: string, rules: object }>} repoResults compareRepo 的结果包装
 * @param {Array<{ ruleName: string, smell: string }>} rules 规则展示信息
 */
function summarizeF1(repoResults, rules) {
  const perRule = rules.map(({ ruleName, smell }) => {
    const totals = { tp: 0, fp: 0, fn: 0 };
    for (const repoResult of repoResults) {
      const ruleResult = repoResult.rules && repoResult.rules[ruleName];
      if (ruleResult) {
        totals.tp += ruleResult.tp;
        totals.fp += ruleResult.fp;
        totals.fn += ruleResult.fn;
      }
    }
    return { rule: ruleName, smell, ...totals, ...computeMetrics(totals) };
  });
  const overallTotals = { tp: 0, fp: 0, fn: 0 };
  for (const rule of perRule) {
    overallTotals.tp += rule.tp;
    overallTotals.fp += rule.fp;
    overallTotals.fn += rule.fn;
  }
  return {
    perRule,
    overall: { rule: 'TOTAL', smell: 'TOTAL', ...overallTotals, ...computeMetrics(overallTotals) },
  };
}

function formatPercent(value) {
  return value === null ? '—' : `${(value * 100).toFixed(2)}%`;
}

function buildF1Markdown(report) {
  const lines = [];
  lines.push('# ArkTS 异味检测 F1 评估报告');
  lines.push('');
  lines.push(`- 生成时间: ${report.generatedAt}`);
  lines.push(`- 数据集目录: ${report.datasetDir}`);
  lines.push('');
  lines.push('## 评估口径');
  lines.push('');
  lines.push('- 各仓库按 HEAD 克隆扫描，未逐 commit 固定，行号漂移可能带来少量误差');
  lines.push('- FP 仅统计正负例标注覆盖的文件，未标注文件中的告警不参与');
  lines.push('- 匹配规则：检测行落在标注行范围内，或两者范围重叠；code-clone 额外匹配 message 中的第二个片段');
  lines.push('');
  lines.push('## 规则汇总');
  lines.push('');
  lines.push('| 规则 | TP | FP | FN | Precision | Recall | F1 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const rule of [...report.summary.perRule, report.summary.overall]) {
    lines.push([
      `| ${rule.smell}`,
      String(rule.tp),
      String(rule.fp),
      String(rule.fn),
      formatPercent(rule.precision),
      formatPercent(rule.recall),
      `${formatPercent(rule.f1)} |`,
    ].join(' | '));
  }
  lines.push('');
  lines.push('## 仓库明细');
  lines.push('');
  lines.push('| 仓库 | 规则 | TP | FP | FN | Precision | Recall | F1 |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const repoResult of report.repoResults) {
    for (const { ruleName, smell } of report.rules) {
      const ruleResult = repoResult.rules && repoResult.rules[ruleName];
      if (!ruleResult) {
        continue;
      }
      const metrics = computeMetrics(ruleResult);
      lines.push([
        `| ${repoResult.repoName}`,
        smell,
        String(ruleResult.tp),
        String(ruleResult.fp),
        String(ruleResult.fn),
        formatPercent(metrics.precision),
        formatPercent(metrics.recall),
        `${formatPercent(metrics.f1)} |`,
      ].join(' | '));
    }
  }
  lines.push('');
  lines.push('## 漏报清单（FN）');
  lines.push('');
  for (const repoResult of report.repoResults) {
    for (const { ruleName, smell } of report.rules) {
      const ruleResult = repoResult.rules && repoResult.rules[ruleName];
      if (!ruleResult) {
        continue;
      }
      for (const item of ruleResult.fnList) {
        lines.push(`- [${smell}] ${repoResult.repoName}/${item.file}:${item.rangeStart}-${item.rangeEnd}`);
      }
    }
  }
  lines.push('');
  lines.push('## 误报清单（FP）');
  lines.push('');
  for (const repoResult of report.repoResults) {
    for (const { ruleName, smell } of report.rules) {
      const ruleResult = repoResult.rules && repoResult.rules[ruleName];
      if (!ruleResult) {
        continue;
      }
      for (const item of ruleResult.fpList) {
        lines.push(`- [${smell}] ${repoResult.repoName}/${item.file}:${item.line} ${item.message || ''}`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  DATASET_REPO_URL_TEMPLATE,
  buildDatasetRepos,
  buildF1Markdown,
  compareRepo,
  computeMetrics,
  extractDetectionLocations,
  formatPercent,
  loadGroundTruth,
  locationMatches,
  parseCsvRows,
  splitRepoRelFile,
  summarizeF1,
  toRepoRelative,
};
