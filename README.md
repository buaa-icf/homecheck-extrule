# ExtraRuleProject

ArkTS 代码检查自定义规则项目，基于 [homecheck](https://gitcode.com/openharmony-sig/homecheck) 框架开发的扩展规则。

## 功能特性

- [**Long Method Check**](docs/long-method-check.md) (`@extrulesproject/long-method-check`)
- [**Feature Envy Check**](docs/feature-envy-check.md) (`@extrulesproject/feature-envy-check`)
- [**Switch Statement Check**](docs/switch-statement-check.md) (`@extrulesproject/switch-statement-check`)
- [**Code Clone Fragment Check**](docs/code-clone-fragment-check.md) (`@extrulesproject/code-clone-fragment-check`)

## 安装

```bash
npm install
```

### 配置文件

根目录下新建 config 目录，并在其中创建 `projectConfig.json` 和 `ruleConfig.json` 两个配置文件。

`ohosSdkPath` 和 `hmsSdkPath` 位于 DevEco Studio 安装目录下的 `DevEco Studio/sdk/default/openharmony/ets` 和 `DevEco Studio/sdk/default/hms/ets`。

projectConfig.json 示例：

```json
{
  "projectName": "",
  "projectPath": "..",
  "repos": [
    "agc-template-market-harmonyos-demos",
    "applications_photos",
    "applications_settings",
    "cases",
    "model-evaluation-testsuite",
    "openharmony_tpc_samples",
    "ostest_integration_test",
    "feature-envy=D:/ROG/Documents/harmonyos/feature-envy_refactor"
  ],
  "datasetDir": "../arkts-code-smell/dataset",
  "logPath": "./HomeCheck.log",
  "ohosSdkPath": "E:/DevEco Studio/sdk/default/openharmony/ets",
  "hmsSdkPath": "E:/DevEco Studio/sdk/default/hms/ets",
  "checkPath": "",
  "sdkVersion": 20,
  "fix": "false",
  "npmPath": "",
  "npmInstallDir": "./",
  "reportDir": "./report",
  "arkCheckPath": "",
  "product": "default",
  "sdksThirdParty": []
}
```

ruleConfig.json 示例：

`packagePath` 为本项目打包后的 tgz 文件路径。

```json
{
  "files": [
    "**/*.ets",
    "**/*.ts"
  ],
  "ignore": [
    "**/ohosTest/**/*",
    "**/node_modules/**/*",
    "**/build/**/*",
    "**/hvigorfile/**/*",
    "**/oh_modules/**/*",
    "**/.preview/**/*"
  ],
  "rules": {},
  "ruleSet": [],
  "overrides": [],
  "extRuleSet": [
    {
      "ruleSetName": "extrulesproject",
      "packagePath": "path/to/extrulesproject-1.0.0.tgz",
      "extRules": {
        "@extrulesproject/code-clone-fragment-check": 3
      }
    }
  ]
}
```

## 运行

完成配置后，日常扫描和评测直接运行：

```powershell
npm run perf:gitcode
```

该命令可以批量扫描仓库，统计告警数量和性能数据；配置了 `datasetDir` 时还会计算 F1。运行时默认启动实时面板，并在结束后生成 HTML 报告。

### 打包扩展规则

修改规则源码后，需要重新生成供 HomeCheck 加载的规则包：

```powershell
npm pack
```

该命令会把当前扩展规则项目打包为根目录下的 `extrulesproject-1.0.0.tgz`。只修改扫描仓库、数据集或配置文件时不需要重复执行。

### 批量评测配置

脚本固定读取仓库内的 `config/projectConfig.json` 和 `config/ruleConfig.json`，无需在命令中重复指定。规则包和 HomeCheck 路径也会按当前 `homecheck-extrule` 目录自动解析。

仓库位置、扫描范围和数据集可以直接写在 `config/projectConfig.json`：`projectPath` 指向包含各源码仓库的根目录，`repos` 统一列出要扫描的仓库，`datasetDir` 指向 F1 标注数据集。将 `datasetDir` 设为 `""` 时不加载数据集，只统计指定仓库的性能和检出的异味数量。

上面的示例同时适用于默认的批量评测命令。相对路径均以执行 `npm run perf:gitcode` 时的当前目录为基准；绝对路径直接使用。配置字段说明如下：

| 字段 | 示例/建议值 | 作用 |
| --- | --- | --- |
| `projectName` | `""` | 单项目运行时的项目名；批量评测时自动替换为当前仓库名，可以留空 |
| `projectPath` | `".."` | 批量评测的仓库根目录。`repos` 中只有名称的条目从该目录下查找，例如 `../cases`；命令行 `--reposRoot` 可覆盖 |
| `repos` | `["cases", "custom=D:/projects/custom", "my-repo=https://example.com/my-repo.git"]` | 统一的仓库列表。`名称` 使用 `projectPath/名称`；`名称=路径或Git地址` 使用显式目标 |
| `datasetDir` | `"../arkts-code-smell/dataset"` | 数据集的 `dataset` 目录，内部应直接包含 `positive` 和 `negative`。非空时运行 F1；设为 `""` 时只统计性能与告警数量 |
| `logPath` | `"./HomeCheck.log"` | HomeCheck 日志文件路径。留空时写到当前仓库的自动报告目录；批量扫描时建议留空，避免多个仓库共用一个日志文件 |
| `ohosSdkPath` | DevEco SDK 的绝对路径 | OpenHarmony ETS SDK 目录，必须按本机 DevEco Studio 安装位置设置 |
| `hmsSdkPath` | DevEco SDK 的绝对路径 | HMS ETS SDK 目录，必须按本机 DevEco Studio 安装位置设置 |
| `checkPath` | `""` | 可选的“指定检查文件列表”配置文件路径，不是源码目录；留空表示按 `ruleConfig.json` 的 `files/ignore` 扫描 |
| `sdkVersion` | `20` | HomeCheck 构建分析场景时使用的 SDK API 版本，应与待测工程兼容 |
| `fileConcurrency` | `1` | HomeCheck 子进程异步文件操作的并发上限；默认串行读取，流式打开另由 `graceful-fs` 在 `EMFILE` 时排队重试 |
| `fix` | `"false"` | 是否启用规则自动修复；本项目的性能/F1 评测建议保持关闭 |
| `npmPath` | `""` | npm 可执行程序；留空时 HomeCheck 使用系统 PATH 中的 `npm` |
| `npmInstallDir` | `"./"` | HomeCheck 安装扩展规则包时使用的 npm 目录，一般保持默认 |
| `reportDir` | `"./report"` | HomeCheck 原始报告根目录。批量评测会在其下增加仓库名，例如 `./report/cases`；留空时使用脚本自己的运行报告目录 |
| `arkCheckPath` | `""` 或 `"./node_modules/homecheck"` | HomeCheck 安装目录，目录中必须存在 `lib/run.js`；留空时自动使用当前项目的 `node_modules/homecheck` |
| `product` | `"default"` | HarmonyOS 工程的产品名，应与待测工程构建配置一致，通常为 `default` |
| `sdksThirdParty` | `[]` | 可选的第三方 SDK 配置；没有额外 SDK 时保持空数组 |

命令行、配置文件与默认值的优先级为：命令行参数 > `projectConfig.json` > 脚本默认值。命令行只覆盖明确传入的字段。

### 运行方式

按 `projectConfig.json` 的 `repos` 扫描，并在配置有效数据集时同时生成 F1：

```powershell
npm run perf:gitcode
```

只生成性能结果，不加载数据集或计算 F1：

```powershell
npm run perf:gitcode -- `
  --f1=false
```

只生成 F1 结果，不运行 CLOC、不采集吞吐量和内存：

```powershell
npm run perf:gitcode -- `
  --perf=false
```

以上命令默认都会启动实时面板，并在结束后生成 `perfDashboard.html`。`--perf=false` 时面板只显示进度和可用的 F1 信息。如果同时关闭性能且没有启用数据集 F1，脚本会提示没有可执行任务。

- `projectPath`（命令行覆盖名为 `reposRoot`）是源码仓库根目录；例如 `projectPath=..` 且 `repos` 中有 `cases` 时，实际扫描 `../cases`
- 本地已有仓库会直接复用；缺少的已知仓库会下载到 `reposRoot`，加 `--updateExisting=true` 才会更新已有 Git 仓库
- `datasetDir` 只提供 F1 标签；是否计算 F1 仅按 `repos` 条目左侧的仓库名精确匹配，不检查显式目录内部是否还包含其他数据集仓库
- `projectConfig.json` 使用统一的 `repos` 选择仓库：`仓库名` 扫描 `projectPath/仓库名`，`仓库名=路径或Git地址` 使用显式目标
- 启用 `datasetDir` 后，`repos` 中有数据集标注的仓库会在性能扫描后继续计算 F1；没有标注的仓库只生成性能结果
- 每个仓库只启动一次 HomeCheck，`code-clone-fragment`、`feature-envy`、`long-method`、`switch-statement` 四种异味检测共享同一份 Scene 预处理
- 性能统计前由 Node 受控枚举 `.ets` 和 `.ts` 文件，再通过 CLOC 文件清单统计行数：`.ets` 按 ArkTs、`.ts` 按 TypeScript 解析；范围与 HomeCheck 一致，同时避免 CLOC 在大型复杂目录中递归失败
- 运行中打开终端打印的 `Live dashboard` 地址可看实时面板；结束后结果保存在 `report/.perftest/gitcode_arkts_smell_perf/`：
  - `perfDashboard.html`：性能面板，浏览器直接打开
  - `perfReport.md`：性能汇总（检测耗时、吞吐、峰值内存）
  - `f1Report.md`：F1 汇总（TP/FP/FN/TN、Precision/Recall/F1 及漏报/误报清单，含计算公式）

### 常用参数

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `--reposRoot=<path>` | `projectConfig.projectPath`，再回退到 `report/.perftest/gitcode_arkts_repos` | 覆盖仓库根目录，目标路径为 `reposRoot/仓库名` |
| `projectConfig.repos` | 无 | 统一选择仓库；`名称` 使用 `projectPath/名称`，`名称=路径或Git地址` 使用显式目标 |
| `--perf=false` | `true` | 不生成性能统计；仍执行 HomeCheck 以供 F1 比对 |
| `--f1=false` | 数据集路径非空时启用 | 即使配置了数据集，也强制不加载、不计算 F1 |
| `--datasetDir=<path>` | `projectConfig.datasetDir` | 覆盖 F1 标签数据集目录；配置为空时不运行 F1 |
| `--outputDir=<path>` | `report/.perftest/gitcode_arkts_smell_perf` | JSON、Markdown 和面板输出目录 |
| `--includeRules=a,b` | 四条规则 | 只启用指定异味，可用值为 `code-clone-fragment`、`feature-envy`、`long-method`、`switch-statement` |
| `--dashboard=false` | `true` | 关闭实时 HTTP 面板；最终 HTML 仍会生成 |
| `--dashboardPort=<n>` | 自动选择 | 固定实时面板端口，例如 `3000` |
| `--updateExisting=true` | `false` | 对已有 Git 仓库执行快进更新 |
| `--nodeMaxOldSpaceMB=<n>` | `8192` | HomeCheck 子进程最大堆内存（MB） |
| `--fileConcurrency=<n>` | `1` | 覆盖异步文件操作并发上限；大仓库默认串行读取以降低文件句柄压力 |
| `--timeoutMs=<n>` | `3600000` | 单仓库超时时间（毫秒，默认 1 小时） |

`--baseProjectConfig`、`--baseRuleConfig` 和 `--runnerPath` 仅作为高级覆盖参数保留，普通运行无需填写。SDK 路径仍需在 `config/projectConfig.json` 中按本机 DevEco Studio 安装位置填写绝对路径。
`projectConfig.json` 中的 `reportDir`、`logPath`、`arkCheckPath` 也会生效：非空时使用配置值，相对路径以运行命令的目录为基准；留空时脚本才自动生成报告/日志位置或定位当前项目的 `node_modules/homecheck`。批量扫描时会在 `reportDir` 下按仓库名建立子目录，避免多个仓库互相覆盖。

规则配置见 `config/ruleConfig.json`，完整参数列表见 `node ./scripts/gitcodeArktsPerfTest.js --help`。
