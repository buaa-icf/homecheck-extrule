// ============================================================
// @file: IntraMethodClone.ets
// @category: positive/fragment_same_method
// @expect: fragment-clone within same method
// @clone-type: Fragment (方法内部重复)
// @scope: SAME_METHOD
// @description: 同一个方法内部存在两段重复的代码片段
// ============================================================

@Component
struct DataProcessor {
    @State data: number[] = []
    @State result: number = 0

    build() {
        Column() {
            Text("数据处理器")
                .fontSize(24)
            Button("处理")
                .onClick(() => {
                    this.processData()
                })
        }
    }

    /**
     * 这个方法内部存在两段重复的代码
     * 片段1: 第一个数据处理块
     * 片段2: 第二个数据处理块（与片段1相同）
     */
    processData(): void {
        let items = this.data
        
        // ========== 重复片段 1 开始 ==========
        let sum1 = 0
        let count1 = 0
        let max1 = 0
        let min1 = Number.MAX_VALUE
        
        for (let i = 0; i < items.length; i++) {
            let item = items[i]
            if (item > 0) {
                sum1 = sum1 + item
                count1 = count1 + 1
                if (item > max1) {
                    max1 = item
                }
                if (item < min1) {
                    min1 = item
                }
            }
        }
        
        let average1 = count1 > 0 ? sum1 / count1 : 0
        let range1 = max1 - min1
        
        console.log("第一次计算结果: " + average1.toString())
        console.log("范围: " + range1.toString())
        // ========== 重复片段 1 结束 ==========

        // 中间有一些不同的代码
        this.result = average1

        // ========== 重复片段 2 开始 ==========
        // 这段代码与上面的片段1完全相同
        let sum2 = 0
        let count2 = 0
        let max2 = 0
        let min2 = Number.MAX_VALUE
        
        for (let i = 0; i < items.length; i++) {
            let item = items[i]
            if (item > 0) {
                sum2 = sum2 + item
                count2 = count2 + 1
                if (item > max2) {
                    max2 = item
                }
                if (item < min2) {
                    min2 = item
                }
            }
        }
        
        let average2 = count2 > 0 ? sum2 / count2 : 0
        let range2 = max2 - min2
        
        console.log("第二次计算结果: " + average2.toString())
        console.log("范围: " + range2.toString())
        // ========== 重复片段 2 结束 ==========

        this.result = average2
    }

    // 独特方法，不是克隆
    uniqueMethod(): void {
        console.log("This is unique")
    }
}
