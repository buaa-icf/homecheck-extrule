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

`ohosSdkPath` 和 `hmsSdkPath` 路径与 DevEco 安装路径有关，mac 中常为 `/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/ets` 与 `/Applications/DevEco-Studio.app/Contents/sdk/default/hms/ets`。

projectConfig.json 示例：

```json
{
  "projectName": "TestProject",
  "projectPath": "/path/to/project",
  "logPath": "./HomeCheck.log",
  "ohosSdkPath": "/path/to/ohosSdk",
  "hmsSdkPath": "/path/to/hmsSdk",
  "checkPath": "",
  "sdkVersion": 20,
  "fix": "false",
  "npmPath": "",
  "npmInstallDir": "./",
  "reportDir": "/path/to/reportDir",
  "arkCheckPath": "./node_modules/homecheck",
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

```bash
npm pack

node ./node_modules/homecheck/lib/run.js --projectConfigPath=./config/projectConfig.json --configPath=./config/ruleConfig.json
```

### 性能测试脚本

config 目录下新建 `ruleConfig.perfAll.json`

```json
{
  "files": [
    "**/*.ets"
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
        "@extrulesproject/long-method-check": 2,
        "@extrulesproject/feature-envy-check": 2,
        "@extrulesproject/switch-statement-check": 2,
        "@extrulesproject/foreach-args-check": 2,
        "@extrulesproject/code-clone-fragment-check": 2
      }
    }
  ]
}

```

使用 `perf:gitcode` 可对固定的 4 个 GitCode 仓库执行端到端性能测试：

```bash
npm run perf:gitcode
```

脚本基于 `projectConfig.json` 生成临时配置文件

- 覆盖 projectName
- 覆盖 projectPath 为当前被测仓库路径
- 覆盖 reportDir 为当前仓库/异味的独立输出目录

脚本会克隆或复用以下仓库，使用 `cloc` 统计 `.ets` 代码行数，并分别运行
`code-clone-fragment`、`feature-envy`、`long-method`、`switch-statement`
四种异味检测：

- `https://gitcode.com/HarmonyOS-Cases/cases.git`
- `https://gitcode.com/openharmony-sig/ostest_integration_test`
- `https://gitcode.com/openharmony/arkui_ace_engine.git`
- `https://gitcode.com/appgallery_connect/agc-template-market-harmonyos-demos.git`

输出目录默认为 `report/.perftest/gitcode_arkts_smell_perf`，主要产物包括：

- `perfReport.md`：中文 Markdown 汇总，包含 `.ets` 行数、外层脚本耗时、告警对象数、告警指标数、端到端吞吐和 `peakHeapMB`
- `summary.json`：结构化汇总数据
- `perfReport.json`：类似 `report/.perftest/tier2_cases/perfReport.json` 的性能报告
- `runs/<repo>/<smell>/issuesReport.json`：单仓库单异味的告警报告
- `runs/<repo>/<smell>/perfReport.json`：单仓库单异味的原始性能报告

常用参数：

```bash
# 只跑指定仓库或异味
npm run perf:gitcode -- --includeRepos=cases --includeRules=long-method

# 复用已有仓库时执行 git pull --ff-only
npm run perf:gitcode -- --updateExisting=true

# 调整单次检测超时和 homecheck 子进程堆内存
npm run perf:gitcode -- --timeoutMs=1800000 --nodeMaxOldSpaceMB=8192
```
