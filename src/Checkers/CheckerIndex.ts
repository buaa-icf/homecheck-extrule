import { ForeachArgsCheck } from "./ForEachArgsCheck";
import { LongMethodCheck } from "./LongMethodCheck";

// 新增文件级的checker，需要在此处注册
export const file2CheckRuleMap: Map<string, any> = new Map();
file2CheckRuleMap.set("@extrulesproject/foreach-args-check", ForeachArgsCheck);
file2CheckRuleMap.set("@extrulesproject/long-method-check", LongMethodCheck);

// 新增项目级checker，需要在此处注册
export const project2CheckRuleMap: Map<string, any> = new Map();