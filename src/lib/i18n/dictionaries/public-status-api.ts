/**
 * i18n dictionary: server-side copy of the public status board
 * (`backend.publicStatus.*`). Owned by the status board area.
 */
export const zh: Record<string, string> = {
	"backend.publicStatus.notFound": "未找到该公开节点",
	"backend.publicStatus.disabled": "状态展示页未公开",
	"backend.publicStatus.serverNotFound": "服务器不存在",
	"backend.publicStatus.nameRequired": "请填写公开名称；公开名称不会自动使用内部名称或主机地址",
	"backend.publicStatus.containsHost": "公开字段不能包含该服务器的主机地址",
	"backend.publicStatus.countryCodeInvalid": "国家或地区代码必须是两位字母（ISO 3166-1），例如 JP。",
};

export const en: Record<string, string> = {
	"backend.publicStatus.notFound": "Public node not found",
	"backend.publicStatus.disabled": "The status board is not public",
	"backend.publicStatus.serverNotFound": "Server not found",
	"backend.publicStatus.nameRequired": "Enter a public name; the internal name or host is never used as a fallback",
	"backend.publicStatus.containsHost": "Public fields must not contain the server's host address",
	"backend.publicStatus.countryCodeInvalid": "The country code must be two letters (ISO 3166-1), for example JP.",
};
