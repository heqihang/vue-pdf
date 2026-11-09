import axios from 'axios'

/** 同源加载静态资源。PDF、JSON 和保存文件在本机浏览器处理，不发送到服务端。 */
export const http = axios.create({
  baseURL: import.meta.env.BASE_URL,
  timeout: 120_000,
})
