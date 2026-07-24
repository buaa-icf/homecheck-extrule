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

一键运行（性能测试 + 数据集 F1 评估）：

```bash
npm run perf:gitcode
```

- 首次运行会克隆测试仓库（gitcode 基准仓库 + `../arkts-code-smell/dataset` 标注涉及的数据集仓库）到 `report/.perftest/gitcode_arkts_repos/`，之后自动复用，加 `--updateExisting=true` 可更新
- 基准仓库（含 arkui_ace_engine 等大仓库）只采集性能数据；数据集仓库额外参与 F1 评估；两者同名时以数据集版本为准，基准组自动跳过
- `--extraRepos` 可追加任意仓库（本地目录或 git 地址）做纯性能测试，与基准仓库同流程、不参与 F1
- 每个仓库只启动一次 HomeCheck，`code-clone-fragment`、`feature-envy`、`long-method`、`switch-statement` 四种异味检测共享同一份 Scene 预处理
- 运行中打开终端打印的 `Live dashboard` 地址可看实时面板；结束后结果保存在 `report/.perftest/gitcode_arkts_smell_perf/`：
  - `perfDashboard.html`：性能面板，浏览器直接打开
  - `perfReport.md`：性能汇总（检测耗时、吞吐、峰值内存）
  - `f1Report.md`：F1 汇总（TP/FP/FN/TN、Precision/Recall/F1 及漏报/误报清单，含计算公式）

常用参数：

```bash
npm run perf:gitcode -- --f1=false                      # 只测性能，不做 F1 评估
npm run perf:gitcode -- --includeRepos=arkui_ace_engine # 只跑指定基准仓库
npm run perf:gitcode -- --extraRepos=MyRepo=/path/to/repo            # 追加任意本地仓库
npm run perf:gitcode -- --extraRepos=MyRepo=https://github.com/x/y.git  # 追加任意 git 仓库
npm run perf:gitcode -- --f1Repos=applications_photos   # 只跑指定数据集仓库
npm run perf:gitcode -- --dashboard=false               # 关闭实时面板（CI 适用）
```

规则配置见 `config/ruleConfig.perfAll.json`，完整参数列表见 `node ./scripts/gitcodeArktsPerfTest.js --help`。
