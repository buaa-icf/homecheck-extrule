// ============================================================
// @file: Type2LogA.ets
// @category: positive/type2_with_logs
// @expect: clone-with Type2LogB.ets (需开启 ignoreLogs)
// @clone-type: Type-2 (标识符重命名 + 日志不同)
// @description: 与 Type2LogB.ets 结构相同，变量名不同，日志库不同
// @methods-cloned: handleRequest↔processInput
// @requires: ignoreLogs = true (默认开启)
// ============================================================

@Component
struct Type2LogA {
  build() {
    Column() {
      Text("Type2日志测试A")
    }
  }

  // 处理请求，使用 console
  handleRequest(requestData: number[]): number {
    console.log("处理请求开始")
    let total = 0
    for (let idx = 0; idx < requestData.length; idx++) {
      let item = requestData[idx]
      if (item > 0) {
        total = total + item
      }
    }
    console.log("处理请求完成")
    return total
  }
}
