// ============================================================
// @file: FragmentWithLogsA.ets
// @category: positive/fragment_with_logs
// @expect: fragment-clone with FragmentWithLogsB.ets (需开启 ignoreLogs)
// @clone-type: Fragment (含日志语句的克隆，过滤后仍应检出业务逻辑克隆)
// @scope: DIFFERENT_CLASS
// @description: 与 FragmentWithLogsB 业务逻辑相同，仅日志调用不同；验证过滤后仍能检出
// @requires: ignoreLogs = true (默认开启)
// ============================================================

@Component
struct DataHandlerA {
    @State items: number[] = []

    build() {
        Column() {
            Text("处理器A")
        }
    }

    /**
     * 与 FragmentWithLogsB.processItems 相同的业务逻辑，此处用 console.* 打日志
     */
    processItems(): number {
        let list = this.items
        // ========== 重复片段开始（含日志，过滤后应与 B 一致）==========
        let sum = 0
        let count = 0
        let maxVal = 0
        let minVal = Number.MAX_VALUE
        let validItems: number[] = []

        for (let i = 0; i < list.length; i++) {
            let v = list[i]
            if (v <= 0) {
                continue
            }
            if (v > 10000) {
                continue
            }
            validItems.push(v)
            sum = sum + v
            count = count + 1
            if (v > maxVal) {
                maxVal = v
            }
            if (v < minVal) {
                minVal = v
            }
        }

        let avg = count > 0 ? sum / count : 0
        let range = maxVal - minVal
        let rate = list.length > 0 ? count / list.length : 0

        console.log("处理器A: 平均值 " + avg.toString())
        console.info("处理器A: 范围 " + range.toString())
        console.debug("有效率: " + rate.toString())

        return avg
        // ========== 重复片段结束 ==========
    }
}
