# Foreach Args Check

## 描述

检测 `ForEach.create(...)` 参数不足（未提供 `keyGenerator`）的场景，降低列表渲染性能风险。

## 默认参数

- `minArgs`: `3`

## 配置示例

```json
{
  "rules": {
    "@extrulesproject/foreach-args-check": {
      "level": 1,
      "options": {
        "minArgs": 3
      }
    }
  }
}
```

## 说明

- 默认规则要求 `ForEach.create` 至少 3 个参数（数据源、渲染函数、key 生成器）。
