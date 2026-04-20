/**
 * sheets.js
 * Google Sheets integration untuk Restaurant AI Agent.
 *
 * Setup:
 * 1. Buat Google Cloud project → enable Sheets API
 * 2. Buat Service Account → download JSON key
 * 3. Share spreadsheet ke email service account (Editor)
 * 4. Set env: GOOGLE_SHEETS_ID dan GOOGLE_SERVICE_ACCOUNT_JSON (JSON key as string)
 *
 * Sheet tabs yang dibutuhkan (buat manual atau pakai initSheets()):
 *   - Menu       : Nama | Kategori | Harga | Tersedia
 *   - Pesanan    : ID | Timestamp | Nama | Meja | Items | Total | Status | Catatan
 *   - Reservasi  : ID | Timestamp | Nama | Tanggal | Jam | Jumlah_Tamu | Kontak | Status | Catatan
 */

import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

// Sheet tab names
export const SHEETS = {
  MENU: 'Menu',
  PESANAN: 'Pesanan',
  RESERVASI: 'Reservasi',
};

// Headers per sheet
const HEADERS = {
  [SHEETS.MENU]: ['Nama', 'Kategori', 'Harga', 'Tersedia', 'Deskripsi'],
  [SHEETS.PESANAN]: ['ID', 'Timestamp', 'Nama_Pelanggan', 'Meja', 'Items', 'Total', 'Status', 'Catatan'],
  [SHEETS.RESERVASI]: ['ID', 'Timestamp', 'Nama', 'Tanggal', 'Jam', 'Jumlah_Tamu', 'Kontak', 'Status', 'Catatan'],
};

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env tidak di-set');

  const key = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson;

  return new google.auth.GoogleAuth({
    credentials: key,
    scopes: SCOPES,
  });
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

function generateId() {
  return Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function nowTimestamp() {
  return new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

// ── Init: buat header row kalau sheet masih kosong ─────────────────
export async function initSheets() {
  const sheets = await getSheetsClient();
  for (const [sheetName, headers] of Object.entries(HEADERS)) {
    try {
      // Check if header exists
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1:Z1`,
      });
      if (!res.data.values || res.data.values.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheetName}!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [headers] },
        });
        console.log(`✅ Header created for sheet: ${sheetName}`);
      }
    } catch (e) {
      console.warn(`⚠️  Could not init sheet ${sheetName}:`, e.message);
    }
  }
}

// ── Menu ───────────────────────────────────────────────────────────
export async function getMenu(kategori = null) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEETS.MENU}!A2:E`,
  });

  const rows = res.data.values || [];
  const menu = rows
    .filter(r => r[3] !== 'Tidak')  // filter yang tersedia
    .map(r => ({
      nama: r[0] || '',
      kategori: r[1] || '',
      harga: r[2] || '',
      tersedia: r[3] || 'Ya',
      deskripsi: r[4] || '',
    }));

  if (kategori) {
    return menu.filter(m => m.kategori.toLowerCase().includes(kategori.toLowerCase()));
  }
  return menu;
}

// ── Pesanan (Orders) ───────────────────────────────────────────────
export async function catatPesanan({ namaPelanggan, meja, items, total, catatan = '' }) {
  const sheets = await getSheetsClient();
  const id = 'ORD-' + generateId();
  const timestamp = nowTimestamp();

  const row = [
    id,
    timestamp,
    namaPelanggan,
    meja || '-',
    Array.isArray(items) ? items.join(', ') : items,
    total || '-',
    'Diproses',
    catatan,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEETS.PESANAN}!A:H`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  return { id, timestamp, status: 'Diproses' };
}

export async function getPesanan(namaPelanggan = null) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEETS.PESANAN}!A2:H`,
  });

  const rows = res.data.values || [];
  const pesanan = rows.map(r => ({
    id: r[0], timestamp: r[1], nama: r[2], meja: r[3],
    items: r[4], total: r[5], status: r[6], catatan: r[7],
  }));

  if (namaPelanggan) {
    return pesanan.filter(p => p.nama?.toLowerCase().includes(namaPelanggan.toLowerCase()));
  }
  return pesanan.slice(-10); // 10 pesanan terbaru
}

export async function updateStatusPesanan(orderId, status) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEETS.PESANAN}!A:A`,
  });

  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(r => r[0] === orderId);
  if (rowIndex === -1) throw new Error(`Order ${orderId} tidak ditemukan`);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEETS.PESANAN}!G${rowIndex + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[status]] },
  });

  return { id: orderId, status };
}

// ── Reservasi ──────────────────────────────────────────────────────
export async function buatReservasi({ nama, tanggal, jam, jumlahTamu, kontak, catatan = '' }) {
  const sheets = await getSheetsClient();
  const id = 'RES-' + generateId();
  const timestamp = nowTimestamp();

  const row = [id, timestamp, nama, tanggal, jam, jumlahTamu, kontak, 'Terkonfirmasi', catatan];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEETS.RESERVASI}!A:I`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  return { id, timestamp, status: 'Terkonfirmasi' };
}

export async function getReservasi(tanggal = null, nama = null) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEETS.RESERVASI}!A2:I`,
  });

  const rows = res.data.values || [];
  let reservasi = rows.map(r => ({
    id: r[0], timestamp: r[1], nama: r[2], tanggal: r[3],
    jam: r[4], jumlah_tamu: r[5], kontak: r[6], status: r[7], catatan: r[8],
  }));

  if (tanggal) reservasi = reservasi.filter(r => r.tanggal?.includes(tanggal));
  if (nama) reservasi = reservasi.filter(r => r.nama?.toLowerCase().includes(nama.toLowerCase()));

  return reservasi;
}

export async function batalReservasi(reservasiId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEETS.RESERVASI}!A:A`,
  });

  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(r => r[0] === reservasiId);
  if (rowIndex === -1) throw new Error(`Reservasi ${reservasiId} tidak ditemukan`);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEETS.RESERVASI}!H${rowIndex + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['Dibatalkan']] },
  });

  return { id: reservasiId, status: 'Dibatalkan' };
}
