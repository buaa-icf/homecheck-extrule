// ============================================================
// @file: Config2.ets
// @category: positive/type2_literal
// @expect: clone-with Config1.ets (需开启字面量规范化)
// @clone-type: Type-2 (字面量替换)
// @description: 与 Config1.ets 结构相同，仅字面量值不同
// @methods-cloned: getTimeout, getMessage, isEnabled
// @requires: literal-normalization = true
// ============================================================

@Component
struct Config2 {
  build() {
    Column() {
      Text("配置2")
    }
  }

  // 获取超时时间 - 字面量不同 (5000 vs 3000)
  getTimeout(): number {
    let timeout = 5000
    if (timeout < 2000) {
      timeout = 2000
    }
    return timeout
  }

  // 获取消息 - 字符串字面量不同
  getMessage(): string {
    let msg = "Goodbye World"
    let prefix = "Info: "
    return prefix + msg
  }

  // 是否启用 - 布尔字面量不同
  isEnabled(): boolean {
    let enabled = false
    if (enabled) {
      return true
    }
    return false
  }
}
