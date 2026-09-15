const fs = require('node:fs');
const path = require('node:path');

const CODE_CLONE_RULE = '@extrulesproject/code-clone-fragment-check';

const PATH_GROUPS = [
  {
    category: 'generated-or-cache',
    rule: 'PATH_GENERATED_OR_CACHE',
    segments: new Set(['.test', 'cache', 'build', 'coverage', 'report', '.preview', 'oh_modules', 'node_modules']),
  },
  {
    category: 'test',
    rule: 'PATH_TEST',
    segments: new Set(['test', 'ohostest']),
  },
  {
    category: 'performance-or-benchmark',
    rule: 'PATH_PERFORMANCE_OR_BENCHMARK',
    segments: new Set(['performance', 'benchmark', 'ohbm', 'perfermance']),
  },
];

function normalizePath(value) {
  return typeof value === 'string'
    ? value.trim().replace(/^file:\/\//i, '').replace(/\\/g, '/').replace(/\/{2,}/g, '/')
    : '';
}

function pathKey(value) {
  const normalized = normalizePath(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function pathWithinRepository(filePath, repositoryRoot) {
  if (!filePath || !repositoryRoot) {
    return null;
  }
  const root = path.resolve(repositoryRoot);
  const absolute = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
  const relative = path.relative(root, absolute);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    return normalizePath(relative);
  }
  return null;
}

function classifyOutOfScopePath(filePath, repositoryRoot) {
  const relativePath = pathWithinRepository(filePath, repositoryRoot);
  if (relativePath === null) {
    return null;
  }
  const segments = relativePath.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
  for (const group of PATH_GROUPS) {
    const matchedSegment = segments.find((segment) => group.segments.has(segment));
    if (matchedSegment) {
      return {
        category: group.category,
        rule: group.rule,
        matchedSegment,
        relativePath,
      };
    }
  }
  return null;
}

function isOutOfScopePath(filePath, repositoryRoot) {
  return classifyOutOfScopePath(filePath, repositoryRoot) !== null;
}

function parseClonePeerPath(message) {
  if (typeof message !== 'string') {
    return null;
  }
  const match = message.match(/\bis similar to\s+(.+?):\d+-\d+\.\s*(?:\(|$)/i);
  return match ? match[1].trim().replace(/\s+>\s+.*$/, '') : null;
}

function stripJsonComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function isApplicationBuildProfile(profilePath) {
  try {
    const content = stripJsonComments(fs.readFileSync(profilePath, 'utf8'));
    return /(?:["']app["']|\bapp)\s*:/.test(content);
  } catch {
    return false;
  }
}

function createApplicationRootFinder(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const rootKey = pathKey(root);
  const cache = new Map();
  return function findApplicationRoot(filePath) {
    if (!filePath) {
      return null;
    }
    const absolute = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
    if (pathWithinRepository(absolute, root) === null) {
      return null;
    }
    let current = path.dirname(absolute);
    const visited = [];
    while (true) {
      const key = pathKey(current);
      if (cache.has(key)) {
        const cached = cache.get(key);
        for (const visitedKey of visited) cache.set(visitedKey, cached);
        return cached;
      }
      visited.push(key);
      const profilePath = path.join(current, 'build-profile.json5');
      if (fs.existsSync(profilePath) && isApplicationBuildProfile(profilePath)) {
        for (const visitedKey of visited) cache.set(visitedKey, current);
        return current;
      }
      if (key === rootKey) {
        for (const visitedKey of visited) cache.set(visitedKey, null);
        return null;
      }
      const parent = path.dirname(current);
      if (parent === current || pathWithinRepository(parent, root) === null) {
        for (const visitedKey of visited) cache.set(visitedKey, null);
        return null;
      }
      current = parent;
    }
  };
}

function countIssues(issues) {
  const list = Array.isArray(issues) ? issues : [];
  return {
    issueObjects: list.length,
    issueMessages: list.reduce(
      (sum, issue) => sum + (issue && Array.isArray(issue.messages) ? issue.messages.length : 0),
      0,
    ),
  };
}

function increment(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function filterOutOfScopeIssues(issues, options) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const findApplicationRoot = createApplicationRootFinder(repositoryRoot);
  const removedIssues = [];
  const byRule = {};
  const byCategory = {};
  let unresolvedClonePeerPath = 0;
  let unresolvedProjectBoundary = 0;

  const filteredIssues = (Array.isArray(issues) ? issues : []).flatMap((issue) => {
    if (!issue || !Array.isArray(issue.messages)) {
      return [];
    }
    const keptMessages = [];
    for (const message of issue.messages) {
      let removal = null;
      const primaryMatch = classifyOutOfScopePath(issue.filePath, repositoryRoot);
      if (primaryMatch) {
        removal = {
          filterRule: primaryMatch.rule,
          category: primaryMatch.category,
          matchedPath: issue.filePath,
          relativePath: primaryMatch.relativePath,
          matchedSegment: primaryMatch.matchedSegment,
        };
      } else if (message && message.rule === CODE_CLONE_RULE) {
        const peerPath = parseClonePeerPath(message.message);
        if (!peerPath) {
          unresolvedClonePeerPath += 1;
        } else {
          const peerMatch = classifyOutOfScopePath(peerPath, repositoryRoot);
          if (peerMatch) {
            removal = {
              filterRule: 'CLONE_PEER_OUT_OF_SCOPE_PATH',
              category: peerMatch.category,
              matchedPath: peerPath,
              relativePath: peerMatch.relativePath,
              matchedSegment: peerMatch.matchedSegment,
            };
          } else {
            const currentRoot = findApplicationRoot(issue.filePath);
            const peerRoot = findApplicationRoot(peerPath);
            if (currentRoot && peerRoot && pathKey(currentRoot) !== pathKey(peerRoot)) {
              removal = {
                filterRule: 'CLONE_CROSS_APPLICATION_BOUNDARY',
                category: 'cross-application-clone',
                currentApplicationRoot: currentRoot,
                peerApplicationRoot: peerRoot,
                matchedPath: peerPath,
              };
            } else if (!currentRoot || !peerRoot) {
              unresolvedProjectBoundary += 1;
            }
          }
        }
      }

      if (removal) {
        increment(byRule, removal.filterRule);
        increment(byCategory, removal.category);
        removedIssues.push({ filePath: issue.filePath, message, ...removal });
      } else {
        keptMessages.push(message);
      }
    }
    return keptMessages.length > 0 ? [{ ...issue, messages: keptMessages }] : [];
  });

  const before = countIssues(issues);
  const after = countIssues(filteredIssues);
  return {
    issues: filteredIssues,
    removedIssues,
    stats: {
      before,
      after,
      removedIssueObjects: before.issueObjects - after.issueObjects,
      removedMessages: before.issueMessages - after.issueMessages,
      byRule,
      byCategory,
      unresolvedClonePeerPath,
      unresolvedProjectBoundary,
    },
  };
}

function filterIssuesReportFile(options) {
  const sourceIssues = JSON.parse(fs.readFileSync(options.sourcePath, 'utf8'));
  const result = filterOutOfScopeIssues(sourceIssues, { repositoryRoot: options.repositoryRoot });
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, JSON.stringify(result.issues, null, 2));
  if (options.auditPath) {
    fs.writeFileSync(options.auditPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      repositoryRoot: path.resolve(options.repositoryRoot),
      sourceReportPath: path.resolve(options.sourcePath),
      filteredReportPath: path.resolve(options.outputPath),
      stats: result.stats,
      removedIssues: result.removedIssues,
    }, null, 2));
  }
  return result;
}

module.exports = {
  CODE_CLONE_RULE,
  PATH_GROUPS,
  classifyOutOfScopePath,
  createApplicationRootFinder,
  filterIssuesReportFile,
  filterOutOfScopeIssues,
  isApplicationBuildProfile,
  isOutOfScopePath,
  normalizePath,
  parseClonePeerPath,
  pathWithinRepository,
};
