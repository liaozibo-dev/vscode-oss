# vs-code-oss README

VS Code OSS 同步工作区和OSS文件

目前仅支持：
* Windows
* COS 腾讯云对象存储
* 工作区仅支持 1000 个文件

## 使用

配置 COS：
* 插件配置：VS Code 搜索 settings
* secretId/secretKey: https://console.cloud.tencent.com/cam/capi
* bucket/region: https://console.cloud.tencent.com/cos  
* 存储桶列表 - 存储桶 - 概览 - 存储桶名称/所属地域

* 创建工作区
* 同步本地工作区到 OSS：VS Code 搜索：oss save
* 同步 OSS 到本地工作区

## 插件代码

src\extension.ts

原理

目录数据结构 {path: md5}

path 以 OSS 为准，格式为 <workSpaceName>/path/to/file.md，目录以 / 结尾

扫描本地目录和OSS目录，生成 localMap 和 ossMap

ossSave: 同步本地目录到 OSS
* 上传：本地存在 && 服务器不存在
* 上传：本地存在 && 服务器存在 && md5不一致
* 删除服务器文件：本地不存在 && 服务器存在

ossFetch：同步 OSS 到本地
* 下载：本地不存在 && 服务器存在
* 下载：本地存在 && 服务器存在 && md5不一致
* 删除本地文件、空目录：本地存在 && 服务器不存在

COS 不需要上传目录