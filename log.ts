import dayjs from "dayjs"

export function log(obj: unknown) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss')
    console.log(`${now}:`, obj)
}