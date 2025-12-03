import * as cheerio from 'cheerio';
import { Hono } from 'hono'
import { log } from './log';
import sendGotify from './send-gotify';
export interface PintuAirData {
    id_pintu_air: string
    kode_stasiun: string
    nama_pintu_air: string
    lokasi: string
    sort_number: string
    siaga1: string
    siaga2: string
    siaga3: string
    siaga4: string
    latitude: string
    longitude: string
    file_export: string
    record_status: string
    created_date: string
    created_by: string
    last_updated_date: string
    last_updated_by: string
    tanggal: string
    tinggi_air: string
    tinggi_air_sebelumnya: string
    status_siaga: string
    tma_unaltered: string
}

const CHECK_INTERVAL = 90_000

//ANGKE 32
//Pesanggrahan 02
//P.S. Pesanggrahan (Baru) 34
//Bendung Katulampa (Hulu) 27
//Bendung Katulampa 2 05
const INDICATOR_CODE_STATION = ['32', '34', '05']

const mem: Record<string, any> = {}


const app = new Hono()
main()

async function main() {
    if (!mem['interval']) {
        log('checking...')
        try {
            const data = await fetchData()
            log('deciding...')
            const decision = decide(data)
            if (decision) {
                alarm()
            } else {
                log('aman')
            }
        } catch (error) {
            log(error)
        }
    }
    setTimeout(() => {
        main()
    }, CHECK_INTERVAL);
}

async function fetchData(): Promise<PintuAirData[]> {
    const raw = await fetch("https://poskobanjir.dsdadki.web.id/xmldata.xml");
    const text = await raw.text()
    const $ = cheerio.load(text);
    const pintus = $('Documentelement').find('SP_GET_LAST_STATUS_PINTU_AIR');

    const res = []
    for (const pintu of pintus) {
        const obj = pintu?.children.filter((c) => c.type !== 'text').reduce((prev, c) => {
            if (c.type === 'tag') {
                const first = c.firstChild
                if (!first) {
                    return prev
                }
                return {
                    ...prev,
                    [c.name]: first.type === 'text' ? first.data : null
                }
            }
            return prev
        }, {}) as unknown as PintuAirData
        if (!INDICATOR_CODE_STATION.includes(obj.kode_stasiun)) {
            continue
        }
        res.push(obj)
    }

    return res as PintuAirData[]
}

function decide(data: PintuAirData[]): boolean {
    let count = 0
    let logs = []
    for (const pintu of data) {
        logs.push(`${pintu.nama_pintu_air}:${pintu.tinggi_air} > ${pintu.siaga2}`)
        if (Number(pintu.tinggi_air) > Number(pintu.siaga2)) {
            count++
        }
    }
    console.log(logs.join(" "))
    //lebih dari 2 stasiun indikator, status siaga 2
    if (count > 2) {
        return true
    }
    return false

}

function alarm() {
    const id = setInterval(() => {
        soundAlarm()
    }, 3000)
    mem['interval'] = id
}

function soundAlarm() {
    sendGotify()
}

app.get('/stop', (c) => {
    log('stopping...')
    clearInterval(mem['interval'])
    mem['interval'] = null
    return c.text('ok')
})


sendGotify({
    title: 'Bunjir Alarm Started',
    message: `at ${new Date().toLocaleTimeString()}`
})

export default {
    port: 6001,
    fetch: app.fetch
}