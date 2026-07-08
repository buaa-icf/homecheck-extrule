# ExtraRuleProject

ArkTS 代码检查自定义规则项目，基于 [homecheck](https://gitcode.com/openharmony-sig/homecheck) 框架开发的扩展规则。

## 功能特性

- [**Long Method Check**](docs/long-method-check.md) (`@extrulesproject/long-method-check`)
- [**Feature Envy Check**](docs/feature-envy-check.md) (`@extrulesproject/feature-envy-check`)
- [**Switch Statement Check**](docs/switch-statement-check.md) (`@extrulesproject/switch-statement-check`)
- [**Code Clone Fragment Check**](docs/code-clone-fragment-check.md) (`@extrulesproject/code-clone-fragment-check`)

## 安装

参考

- [homecheck 安装与使用指南](https://gitcode.com/openharmony-sig/homecheck/blob/master/document/user/homecheck%E5%AE%89%E8%A3%85%E4%B8%8E%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md)
- [ExtRule 自定义规则开发指南](https://gitcode.com/openharmony-sig/homecheck/blob/master/document/developer/ExtRule%E8%87%AA%E5%AE%9A%E4%B9%89%E8%A7%84%E5%88%99%E5%BC%80%E5%8F%91%E6%8C%87%E5%8D%97.md)

## 运行

```bash
npm pack

node ./node_modules/homecheck/lib/run.js --projectConfigPath=./config/projectConfig.json --configPath=./config/ruleConfig.json
```

### 性能测试脚本

使用 `perf:gitcode` 可对固定的 4 个 GitCode 仓库执行端到端性能测试：

```bash
npm run perf:gitcode
```

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
