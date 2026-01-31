import { ForeachArgsCheck } from "./ForEachArgsCheck";
import { LongMethodCheck } from "./LongMethodCheck";
import { CodeCloneType1Check } from "./CodeCloneType1Check";
import { CodeCloneType2Check } from "./CodeCloneType2Check";

// 新增文件级的checker，需要在此处注册
export const file2CheckRuleMap: Map<string, any> = new Map();
file2CheckRuleMap.set("@extrulesproject/foreach-args-check", ForeachArgsCheck);
file2CheckRuleMap.set("@extrulesproject/long-method-check", LongMethodCheck);

// 新增项目级checker，需要在此处注册（克隆检测需要跨文件比较）
export const project2CheckRuleMap: Map<string, any> = new Map();
project2CheckRuleMap.set("@extrulesproject/code-clone-type1-check", CodeCloneType1Check);
project2CheckRuleMap.set("@extrulesproject/code-clone-type2-check", CodeCloneType2Check);