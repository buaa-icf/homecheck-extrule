# Switch Statement Check

## 描述

檢測大型 `switch` 語句的代碼異味。大量分支的 `switch` 往往暗示可以用多態、策略模式或查表方式替代，以降低條件分支的複雜度與耦合。

## 默認閾值

- 最小 case 數：**5**（`switch` 中 `case` 個數達到或超過此值即報告）

> 依據每個語句的原始文本統計 `case` 關鍵字次數。

報告內容：會在描述中附帶每個 `case`（包含 `default`）對應的行數，便於判斷哪個分支邏輯較重。

## 配置方式

可在 `ruleConfig.json` 中自定義最小 case 數：

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

**配置參數說明**：
- `minCases`：觸發報告的最小 `case` 數（默認 5）

## 反例代碼

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

## 正例代碼

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

## 參考文獻

- Martin Fowler, "Refactoring: Improving the Design of Existing Code"（Replace Conditional with Polymorphism）
- Robert C. Martin, "Clean Code", Chapter 3: Functions
