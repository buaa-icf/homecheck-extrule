// ============================================================
// @file: PureLogsOnly.ets
// @category: positive/fragment_pure_logs
// @expect: no fragment-clone (过滤后不报为克隆)
// @clone-type: N/A
// @scope: N/A
// @description: 两段完全相同的“纯日志”重复；ignoreLogs 开启后应整段清除，不产生克隆报告
// @requires: ignoreLogs = true (默认开启)
// ============================================================

@Component
struct PureLogsOnly {
    build() {
        Column() {
            Text("纯日志测试")
        }
    }

    /**
     * 方法内两段完全相同的纯日志块。
     * 每段超过 100 tokens，但内容全是 console.log。
     * 过滤后两段都变为空，不应检出为片段克隆。
     */
    logSection(): void {
        // ========== 第一段：纯日志（与第二段完全相同）==========
        console.log("步骤1: 开始处理用户请求")
        console.log("步骤2: 验证输入参数是否合法")
        console.log("步骤3: 查询数据库获取用户信息")
        console.log("步骤4: 检查权限和角色")
        console.log("步骤5: 执行业务逻辑计算")
        console.log("步骤6: 格式化输出结果")
        console.log("步骤7: 写入审计日志")
        console.log("步骤8: 返回响应给客户端")
        console.log("步骤9: 清理临时资源")
        console.log("步骤10: 结束本次请求处理")
        console.log("额外日志: 性能指标记录")
        console.log("额外日志: 错误码统计")
        console.log("额外日志: 缓存命中率")
        console.log("额外日志: 连接池状态")
        console.log("额外日志: 内存使用情况")
        // ========== 第一段结束 ==========

        let unique = 1

        // ========== 第二段：与第一段完全相同的纯日志 ==========
        console.log("步骤1: 开始处理用户请求")
        console.log("步骤2: 验证输入参数是否合法")
        console.log("步骤3: 查询数据库获取用户信息")
        console.log("步骤4: 检查权限和角色")
        console.log("步骤5: 执行业务逻辑计算")
        console.log("步骤6: 格式化输出结果")
        console.log("步骤7: 写入审计日志")
        console.log("步骤8: 返回响应给客户端")
        console.log("步骤9: 清理临时资源")
        console.log("步骤10: 结束本次请求处理")
        console.log("额外日志: 性能指标记录")
        console.log("额外日志: 错误码统计")
        console.log("额外日志: 缓存命中率")
        console.log("额外日志: 连接池状态")
        console.log("额外日志: 内存使用情况")
        // ========== 第二段结束 ==========

        this.dummy(unique)
    }

    dummy(_n: number): void {
    }
}
