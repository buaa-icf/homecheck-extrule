// ============================================================
// @file: MultilineLogClone.ets
// @category: positive/fragment_multiline_logs
// @expect: fragment-clone within same class (多行日志完整清理后仍检出)
// @clone-type: Fragment (多行日志语句的克隆，验证多行日志完整清理)
// @scope: SAME_CLASS
// @description: 同一类两个方法内各有一段相同逻辑，且含多行日志语句；验证多行被完整移除后仍检出克隆
// @requires: ignoreLogs = true (默认开启)
// ============================================================

@Component
struct MultilineLogClone {
    @State data: string[] = []

    build() {
        Column() {
            Text("多行日志测试")
        }
    }

    /**
     * 方法1：包含一段业务逻辑 + 多行日志 + 后续逻辑；与 methodTwo 对应片段相同
     */
    methodOne(): number {
        let items = this.data
        // ========== 重复片段开始（含多行 log）==========
        let total = 0
        let validCount = 0
        let errors: string[] = []

        for (let i = 0; i < items.length; i++) {
            let s = items[i].trim()
            if (s.length === 0) {
                errors.push("空")
                continue
            }
            if (s.length < 2) {
                errors.push("太短")
                continue
            }
            if (s.length > 100) {
                errors.push("太长")
                continue
            }
            validCount = validCount + 1
            total = total + s.length
        }

        let avgLen = validCount > 0 ? total / validCount : 0
        console.log("统计结果: 有效=" + validCount.toString() +
            " 总长=" + total.toString() +
            " 平均=" + avgLen.toString())

        return validCount
        // ========== 重复片段结束 ==========
    }

    /**
     * 方法2：与 methodOne 相同的重复片段（含多行 log），验证多行日志被完整清理
     */
    methodTwo(): number {
        let items = this.data
        // ========== 重复片段开始（含多行 log）==========
        let total = 0
        let validCount = 0
        let errors: string[] = []

        for (let i = 0; i < items.length; i++) {
            let s = items[i].trim()
            if (s.length === 0) {
                errors.push("空")
                continue
            }
            if (s.length < 2) {
                errors.push("太短")
                continue
            }
            if (s.length > 100) {
                errors.push("太长")
                continue
            }
            validCount = validCount + 1
            total = total + s.length
        }

        let avgLen = validCount > 0 ? total / validCount : 0
        console.log("统计结果: 有效=" + validCount.toString() +
            " 总长=" + total.toString() +
            " 平均=" + avgLen.toString())

        return validCount
        // ========== 重复片段结束 ==========
    }
}
