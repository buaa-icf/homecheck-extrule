# Switch Statement Check

## 描述

检测大型 `switch` 语句的代码异味。大量分支往往暗示可以用多态、策略模式或查表方式替代，以降低条件分支的复杂度与耦合。

## 默认阈值

- 最小 case 数：**5**（`switch` 中 `case` 数达到或超过此值即报告）

> 依据每个语句的原始文本统计 `case` 关键字次数。

报告内容：会在描述中附带每个 `case`（包含 `default`）对应的行数，便于判断哪些分支逻辑较重。

## 配置方式

可在 `ruleConfig.json` 中自定义最小 case 数：

```json
{
  "rules": {
    "@extrulesproject/switch-statement-check": {
      "level": 2,
      "options": {
        "minCases": 6
      }
    }
  }
}
```

**配置参数说明**：
- `minCases`：触发报告的最小 `case` 数（默认 5）

## 反例代码

```typescript
function render(status: string) {
  switch (status) {
    case "init": handleInit(); break;
    case "loading": handleLoading(); break;
    case "success": handleSuccess(); break;
    case "empty": handleEmpty(); break;
    case "error": handleError(); break;
    default: handleUnknown();
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
