# ExtraRuleProject

ArkTS 代码检查自定义规则项目，基于 [homecheck](https://gitcode.com/openharmony-sig/homecheck) 框架开发的扩展规则。

## 功能特性

- **Long Method Check** (`@extrulesproject/long-method-check`)
  - 检测方法语句数量超过阈值的方法
  - 默认阈值：50 个语句
  - 可通过配置文件自定义阈值

## 安装

参考

- [homecheck 安装与使用指南](https://gitcode.com/openharmony-sig/homecheck/blob/master/document/user/homecheck%E5%AE%89%E8%A3%85%E4%B8%8E%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md)
- [ExtRule 自定义规则开发指南](https://gitcode.com/openharmony-sig/homecheck/blob/master/document/developer/ExtRule%E8%87%AA%E5%AE%9A%E4%B9%89%E8%A7%84%E5%88%99%E5%BC%80%E5%8F%91%E6%8C%87%E5%8D%97.md)


## 运行
```bash
npm pack

node ./node_modules/homecheck/lib/run.js --projectConfigPath=./config/projectConfig.json --configPath=./config/ruleConfig.json
```

## 许可证

ISC