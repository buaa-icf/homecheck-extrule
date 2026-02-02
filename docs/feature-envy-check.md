# Feature Envy Check

## 描述

检测方法是否存在對其他類的過度依賴（Feature Envy）。如果一個方法對單一外部類的調用次數遠超自身類，可能應該將該邏輯移動到被依賴的類或提取協作對象。

## 默認閾值

- 最少統計的調用數：**3**（低於此值不報告）
- 最少外部調用數：**3**（外部調用少於 3 不報告）
- 外部調用比例：**60%** 及以上，且外部調用次數大於自身類的調用次數

> 調用計數基於方法體內的語句，識別每個調用的目標類，然後按類統計。

## 配置方式

目前僅支持在 `ruleConfig.json` 中調整嚴重級別（`level`）。閾值（最少調用數、比例等）在規則內置，不支持配置：

```json
{
  "rules": {
    "@extrulesproject/feature-envy-check": {
      "level": 2
    }
  }
}
```

## 反例代碼

```typescript
class OrderService {
  process(order: Order) {
    // 大量依賴外部類 PaymentGateway
    this.gateway.validate(order);
    this.gateway.prepare(order);
    this.gateway.charge(order);
    this.gateway.confirm(order);
    this.gateway.notify(order);
  }
}
```

## 正例代碼

```typescript
class PaymentGateway {
  process(order: Order) {
    this.validate(order);
    this.prepare(order);
    this.charge(order);
    this.confirm(order);
    this.notify(order);
  }
}

class OrderService {
  process(order: Order) {
    // 委派給更合適的類
    this.gateway.process(order);
  }
}
```

## 參考文獻

- Martin Fowler, "Refactoring: Improving the Design of Existing Code"（Feature Envy）
- Robert C. Martin, "Clean Code"，Chapter 7: Error Handling
