// ============================================================
// @file: Type2LogB.ets
// @category: positive/type2_with_logs
// @expect: clone-with Type2LogA.ets (需开启 ignoreLogs)
// @clone-type: Type-2 (标识符重命名 + 日志不同)
// @description: 与 Type2LogA.ets 结构相同，变量名不同，日志库不同
// @methods-cloned: processInput↔handleRequest
// @requires: ignoreLogs = true (默认开启)
// ============================================================

@Component
struct Type2LogB {
  build() {
    Column() {
      Text("Type2日志测试B")
    }
  }

  // 处理输入，使用 hilog（变量名与 Type2LogA 不同）
  processInput(inputData: number[]): number {
    hilog.info("Processing input started")
    let result = 0
    for (let index = 0; index < inputData.length; index++) {
      let element = inputData[index]
      if (element > 0) {
        result = result + element
      }
    }
    hilog.info("Processing input finished")
    return result
  }
}
