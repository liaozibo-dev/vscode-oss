// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// file tree
// npm install fs-extra crypto
// npm install @types/fs-extra --save-dev
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';

// cos
// npm i cos-nodejs-sdk-v5 --save

import COS from 'cos-nodejs-sdk-v5';
import { dir } from 'console';
import { REFUSED } from 'dns';
import { off } from 'process';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "helloworld" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('helloworld.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello VS Code!');
	});

	const ossSaveCommand = vscode.commands.registerCommand('oss.save', () => {
		ossSave();
	});

	const ossFetchCommand = vscode.commands.registerCommand('oss.fetch', () => {
		ossFetch();
	});

	const testCommand = vscode.commands.registerCommand('oss.test', () => {
		test();
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(ossSaveCommand);
	context.subscriptions.push(ossFetchCommand);
}

function test() {
	console.log(folders);
}

// This method is called when your extension is deactivated
export function deactivate() {}

/**
 * VS Code OSS 同步工作区和OSS文件
 * 
 * 目前仅支持：
 * 	Windows
 *  COS 腾讯云对象存储
 *  工作区只支持 1000 个文件
 * 
 * 目录数据结构 {path: md5}
 * path 以 OSS 为准，格式为 <workSpaceName>/path/to/file.md，目录以 / 结尾
 * 
 * 扫描本地目录和OSS目录，生成 localMap 和 ossMap
 * ossSave: 同步本地目录到 OSS
 * 	上传：本地存在 && 服务器不存在
 * 	上传：本地存在 && 服务器存在 && md5不一致
 * 	删除服务器文件：本地不存在 && 服务器存在
 * 
 * ossFetch：同步 OSS 到本地
 * 	下载：本地不存在 && 服务器存在
 * 	下载：本地存在 && 服务器存在 && md5不一致
 * 	删除本地文件、空目录：本地存在 && 服务器不存在
 * 
 * COS：
 * 	COS 不需要上传目录
 *  插件配置：VS Code 搜索 settings
 * 	secretId/secretKey: https://console.cloud.tencent.com/cam/capi
 * 	bucket/region: https://console.cloud.tencent.com/cos  存储桶列表 - 存储桶 - 概览 - 存储桶名称/所属地域
 * */ 

// 项目信息
const folders = vscode.workspace.workspaceFolders;
var projectParentPath = '';
var projectPath = '';
var projectName = '';
if (folders?.length === 1) {
	projectPath = folders[0].uri.fsPath;
	projectParentPath = path.dirname(projectPath);
	projectName = folders[0].name;
}

// 更新 OSS
async function ossSave() {
	const localMap = getLocalMap(projectPath);
	const cosMap = await getCosMap(projectName);
	const compareMap = saveCompare(localMap, cosMap);

	// 更新 OSS 文件
	compareMap.get(OP_UPLOAD)?.forEach(filePath => {
		cosUpload(path.join(projectParentPath, filePath), filePath);
	});

	// 删除 OSS 文件
	compareMap.get(OP_DELETE)?.forEach(filePath => {
		cosDelete(filePath);
	});

	vscode.window.showInformationMessage('oss save: done');
}

// 更新本地
async function ossFetch() {
	const localMap = getLocalMap(projectPath);
	const cosMap = await getCosMap(projectName);
	const compareMap = fetchCompare(localMap, cosMap);

	// 更新本地文件
	compareMap.get(OP_DOWNLOAD)?.forEach(filePath => {
		if (filePath.endsWith('/')) {
			return;
		}
		const fullPath = path.join(projectParentPath, filePath);
		const dirPath = path.dirname(fullPath);
		if (!fs.pathExistsSync(dirPath)) {
			fs.mkdirsSync(dirPath);
		}
		cosDownload(filePath, fullPath);
	});

	// 删除本地文件
	compareMap.get(OP_DELETE)?.forEach(filePath => {
		const fullPath = path.join(projectParentPath, filePath);
		if (!filePath.endsWith('/') || fs.readdirSync(fullPath).length === 0) { // file or empty dir
			fs.removeSync(fullPath);
			showNotify('local delete', fullPath);
		}
	});

	vscode.window.showInformationMessage('oss fetch: done');
}

const OP_UPLOAD = 'op_upload';
const OP_DOWNLOAD = 'op_download';
const OP_DELETE = 'op_delete';

function saveCompare(map1: Map<string, string>, map2: Map<string, string>) {
	const result = new Map<string, string[]>();
	result.set(OP_UPLOAD, new Array<string>());
	result.set(OP_DOWNLOAD, new Array<string>());
	result.set(OP_DELETE, new Array<string>());

	const keySet = new Set<string>([...map1.keys(), ...map2.keys()]);

	keySet.forEach(k => {
		if (!map1.has(k)) {
			result.get(OP_DELETE)?.push(k);
		} else if (!map2.has(k)) {
			result.get(OP_UPLOAD)?.push(k);
		} else if (map1.get(k) !== map2.get(k)) {
			result.get(OP_UPLOAD)?.push(k);
		}
	});

	return result;
}

function fetchCompare(map1: Map<string, string>, map2: Map<string, string>) {
	const result = new Map<string, string[]>();
	result.set(OP_UPLOAD, new Array<string>());
	result.set(OP_DOWNLOAD, new Array<string>());
	result.set(OP_DELETE, new Array<string>());

	const keySet = new Set<string>([...map1.keys(), ...map2.keys()]);

	keySet.forEach(k => {
		if (!map1.has(k)) {
			result.get(OP_DOWNLOAD)?.push(k);
		} else if (!map2.has(k)) {
			result.get(OP_DELETE)?.push(k);
		} else if (map1.get(k) !== map2.get(k)) {
			result.get(OP_DOWNLOAD)?.push(k);
		}
	});

	return result;
}

function showNotify(title: string, msg: string) {
	vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: title
	}, (progress, token) => {
		progress.report({ increment: 0 });
		setTimeout(() => {
			progress.report({ increment: 50, message: msg });
		}, 300);
		setTimeout(() => {
			progress.report({ increment: 100, message: msg });
		}, 800);
		const p = new Promise<void>(resolve => {
			setTimeout(() => {
				resolve();
			}, 1600);
		});
		return p;
	});

}

// local
function getLocalMap(root: string): Map<string, string> {
	return doGetLocalMap(root, root, new Map());
}

function doGetLocalMap(root: string, filePath: string, result:Map<string, string>): Map<string, string> {
    if (!fs.pathExists(filePath)) {
        return result;
    }

    const stats = fs.statSync(filePath);
    const relativePath = path.relative(path.dirname(root), filePath);
	 if (stats.isDirectory()) {
		result.set(toLinuxPath(relativePath) + '/', '');
        fs.readdirSync(filePath).forEach(child => doGetLocalMap(root, path.join(filePath, child), result));
    } else {
        result.set(toLinuxPath(relativePath), getMd5(filePath));
	}
    return result;
}

function getMd5(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('md5');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

function toLinuxPath(p: string): string {
    return p.replace(/\\/g, '/');
}

// cos
const cosConfig = vscode.workspace.getConfiguration('cos');
const cosSecretId = cosConfig.get<string>('secretId');
const cosSecretKey = cosConfig.get<string>('secretKey');
const cosBucket = cosConfig.get<string>('bucket', '');
const cosRegion = cosConfig.get<string>('region', '');
// SECRETID 和 SECRETKEY 请登录 https://console.cloud.tencent.com/cam/capi 进行查看和管理
const cos = new COS({
    SecretId: cosSecretId, // 推荐使用环境变量获取；用户的 SecretId，建议使用子账号密钥，授权遵循最小权限指引，降低使用风险。子账号密钥获取可参考https://cloud.tencent.com/document/product/598/37140
    SecretKey: cosSecretKey, // 推荐使用环境变量获取；用户的 SecretKey，建议使用子账号密钥，授权遵循最小权限指引，降低使用风险。子账号密钥获取可参考https://cloud.tencent.com/document/product/598/37140
});

async function getCosMap(projectName: string): Promise<Map<string, string>> {
	const data = await cos.getBucket({
		Bucket: cosBucket,
		Region: cosRegion,
		Prefix: projectName,
	});
	const contents = data.Contents;
	const result = new Map<string, string>();
	if (contents.length === 0) {
		return result;
	}
	for (var i = 0; i < contents.length; i++) {
		const content = contents[i];
		result.set(content.Key, content.ETag.replaceAll('"', ''));
	}
	return result;
}
  

function cosUpload(sourcePath: string, targetPath: string) {
	if (targetPath.endsWith('/')) {
		return;
	}
	showNotify('cos upload', sourcePath + ' ===> ' + targetPath);
	cos.putObject({
		Bucket: cosBucket,
		Region: cosRegion,
		Key: targetPath,
		StorageClass: 'STANDARD',
		Body: fs.createReadStream(sourcePath),
		onProgress: function(progressData) {
			console.log(JSON.stringify(progressData));
		}
	}, function(err, data) {
		console.info(err || data);
	});
	
}

function cosDownload(sourcePath: string, targetPath: string) {
	showNotify('cos download', sourcePath + ' ===> ' + targetPath);
	cos.getObject({
		Bucket: cosBucket, 
		Region: cosRegion,
		Key: sourcePath,
		Output: fs.createWriteStream(targetPath),
	}, function(err, data) {
		console.info(err || data);
	});
	
}

function cosDelete(targetPath: string) {
	if (targetPath.endsWith("/")) {
		return;
	}
	showNotify('cos delete', targetPath);
	cos.deleteObject({
		Bucket: cosBucket,
		Region: cosRegion,
		Key: targetPath,
	}, function(err, data) {
		console.info(err || data);
	});
	
}