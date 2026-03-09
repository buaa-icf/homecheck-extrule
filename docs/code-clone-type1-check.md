# Code Clone Type-1 Check

## 描述

检测方法级 Type-1 克隆：仅允许空白与注释差异，逻辑结构与语句序列完全一致。

## 默认参数

- `minStmts`: `5`
- `ignoreLogs`: `true`
- `ignoreTypes`: `false`
- `ignoreDecorators`: `false`
- `minComplexity`: `0`
- `similarityThreshold`: `1.0`
- `enableCloneClasses`: `false`

## 配置示例

```json
{
  "rules": {
    "@extrulesproject/code-clone-type1-check": {
      "level": 2,
      "options": {
        "minStmts": 5,
        "ignoreLogs": true
      }
    }
  }
}
```

## 说明

- 当 `similarityThreshold < 1.0` 时，会额外报告近似克隆。
- 当 `enableCloneClasses = true` 时，报告将按克隆类聚合。
