# Switch Statement Check

## 描述

检测大型条件分支异味，当前覆盖两类模式：

- 大型 `switch` 语句
- 长串 `if / else if` 链

大量分支往往暗示可以用多态、策略模式或查表方式替代，以降低条件分支的复杂度与耦合。

## 默认阈值

- 最小分支数：**6**

判定方式：

- `switch`：`case` 与 `default` 总数达到或超过 `minCases` 即报告
- `if / else if`：`if` 记 1 个分支，每个 `else if` 再记 1 个分支，最终 `else` 不计入阈值

> `if / else if` 检测基于方法源码文本，仅统计同一层级、连续出现的链，不会把 `else { if (...) }` 当作同一条链。

报告内容：

- `switch` 报告会附带每个 `case`（包含 `default`）对应的行数
- `if / else if` 报告会附带链的分支数量

## 配置方式

可在 `ruleConfig.json` 中自定义最小分支数：

```json
{
  "rules": {
    "@extrulesproject/switch-statement-check": {
      "level": 2,
      "options": {
        "minCases": 7
      }
    }
  }
}
```

**配置参数说明**：
- `minCases`：触发报告的最小分支数（默认 6），同时作用于 `switch` 与 `if / else if`

## 反例代码

```typescript
function render(status: string) {
  if (status === "init") {
    handleInit();
  } else if (status === "loading") {
    handleLoading();
  } else if (status === "success") {
    handleSuccess();
  } else if (status === "empty") {
    handleEmpty();
  } else if (status === "error") {
    handleError();
  } else if (status === "cancelled") {
    handleCancelled();
  } else {
    handleUnknown();
  }
}
```

## 正例代码

```typescript
const handlers: Record<string, () => void> = {
  init: handleInit,
  loading: handleLoading,
  success: handleSuccess,
  empty: handleEmpty,
  error: handleError,
};

function render(status: string) {
  (handlers[status] ?? handleUnknown)();
}
```

## 参考文献

- Martin Fowler, "Refactoring: Improving the Design of Existing Code"（Replace Conditional with Polymorphism）
- Robert C. Martin, "Clean Code", Chapter 3: Functions
