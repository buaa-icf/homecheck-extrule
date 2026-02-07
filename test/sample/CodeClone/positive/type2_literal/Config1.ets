// ============================================================
// @file: Config1.ets
// @category: positive/type2_literal
// @expect: clone-with Config2.ets (需开启字面量规范化)
// @clone-type: Type-2 (字面量替换)
// @description: 与 Config2.ets 结构相同，仅字面量值不同
// @methods-cloned: getTimeout, getMessage, isEnabled
// @requires: literal-normalization = true
// ============================================================

@Component
struct Config1 {
  build() {
    Column() {
      Text("配置1")
    }
  }

  // 获取超时时间 - 字面量不同
  getTimeout(): number {
    let timeout = 3000
    if (timeout < 1000) {
      timeout = 1000
    }
    return timeout
  }

  // 获取消息 - 字符串字面量不同
  getMessage(): string {
    let msg = "Hello World"
    let prefix = "Msg: "
    return prefix + msg
  }

  // 是否启用 - 布尔字面量不同
  isEnabled(): boolean {
    let enabled = true
    if (enabled) {
      return true
    }
    return false
  }
}
