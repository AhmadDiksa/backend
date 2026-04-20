/**
 * restaurant-tools.js
 *
 * LangChain DynamicStructuredTool definitions untuk Restaurant CS Agent.
 * Setiap tool punya Zod schema untuk validasi input — Claude tahu
 * persis apa yang harus dikirim.
 *
 * Tools:
 *   1. lihat_menu           — Tampilkan menu (bisa filter by kategori)
 *   2. catat_pesanan        — Catat pesanan ke Google Sheets
 *   3. cek_pesanan          — Cek status pesanan pelanggan
 *   4. update_status_pesanan— Update status pesanan
 *   5. buat_reservasi       — Buat reservasi ke Google Sheets
 *   6. cek_reservasi        — Cek reservasi (by tanggal atau nama)
 *   7. batal_reservasi      — Batalkan reservasi
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  getMenu,
  catatPesanan,
  getPesanan,
  updateStatusPesanan,
  buatReservasi,
  getReservasi,
  batalReservasi,
} from './sheets.js';

// ── Tool 1: Lihat Menu ─────────────────────────────────────────────
export const lihatMenuTool = new DynamicStructuredTool({
  name: 'lihat_menu',
  description: 'Tampilkan menu restoran. Bisa filter berdasarkan kategori seperti "makanan", "minuman", "dessert". Gunakan ini ketika pelanggan bertanya tentang menu, harga, atau ketersediaan hidangan.',
  schema: z.object({
    kategori: z.string().optional().describe('Kategori menu yang ingin dilihat, contoh: makanan, minuman, dessert. Kosongkan untuk semua menu.'),
  }),
  func: async ({ kategori }) => {
    try {
      const menu = await getMenu(kategori);
      if (menu.length === 0) return `Tidak ada menu${kategori ? ` kategori "${kategori}"` : ''} yang tersedia saat ini.`;

      const grouped = menu.reduce((acc, item) => {
        const cat = item.kategori || 'Lainnya';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(item);
        return acc;
      }, {});

      let result = '📋 **MENU RESTORAN**\n\n';
      for (const [cat, items] of Object.entries(grouped)) {
        result += `**${cat.toUpperCase()}**\n`;
        for (const item of items) {
          result += `• ${item.nama} — Rp ${item.harga}`;
          if (item.deskripsi) result += ` _(${item.deskripsi})_`;
          result += '\n';
        }
        result += '\n';
      }
      return result;
    } catch (e) {
      return `Gagal mengambil menu: ${e.message}`;
    }
  },
});

// ── Tool 2: Catat Pesanan ──────────────────────────────────────────
export const catatPesananTool = new DynamicStructuredTool({
  name: 'catat_pesanan',
  description: 'Catat pesanan pelanggan ke sistem (Google Sheets). Gunakan ini ketika pelanggan ingin memesan makanan atau minuman. Kumpulkan semua informasi yang diperlukan sebelum memanggil tool ini.',
  schema: z.object({
    namaPelanggan: z.string().describe('Nama pelanggan yang memesan'),
    meja: z.string().optional().describe('Nomor meja pelanggan, contoh: "5", "VIP-1"'),
    items: z.array(z.string()).describe('List item yang dipesan, contoh: ["Nasi Goreng x2", "Es Teh x1"]'),
    total: z.string().optional().describe('Total harga, contoh: "Rp 85.000"'),
    catatan: z.string().optional().describe('Catatan khusus, contoh: "tidak pedas", "alergi kacang"'),
  }),
  func: async ({ namaPelanggan, meja, items, total, catatan }) => {
    try {
      const result = await catatPesanan({ namaPelanggan, meja, items, total, catatan });
      return `✅ Pesanan berhasil dicatat!\n\n` +
        `📋 **ID Pesanan:** ${result.id}\n` +
        `⏰ **Waktu:** ${result.timestamp}\n` +
        `👤 **Nama:** ${namaPelanggan}\n` +
        `🪑 **Meja:** ${meja || '-'}\n` +
        `🍽️ **Items:** ${items.join(', ')}\n` +
        `💰 **Total:** ${total || 'Belum dihitung'}\n` +
        `📌 **Status:** ${result.status}\n` +
        (catatan ? `📝 **Catatan:** ${catatan}\n` : '') +
        `\nSilakan simpan ID pesanan Anda untuk referensi!`;
    } catch (e) {
      return `Gagal mencatat pesanan: ${e.message}`;
    }
  },
});

// ── Tool 3: Cek Pesanan ────────────────────────────────────────────
export const cekPesananTool = new DynamicStructuredTool({
  name: 'cek_pesanan',
  description: 'Cek status atau riwayat pesanan pelanggan. Gunakan ini ketika pelanggan ingin tahu status pesanannya.',
  schema: z.object({
    namaPelanggan: z.string().optional().describe('Nama pelanggan untuk filter pesanan'),
  }),
  func: async ({ namaPelanggan }) => {
    try {
      const pesanan = await getPesanan(namaPelanggan);
      if (pesanan.length === 0) return `Tidak ada pesanan ditemukan${namaPelanggan ? ` untuk "${namaPelanggan}"` : ''}.`;

      let result = `📦 **DAFTAR PESANAN**${namaPelanggan ? ` untuk ${namaPelanggan}` : ' (terbaru)'}\n\n`;
      for (const p of pesanan.slice(-5)) {
        const statusEmoji = { 'Diproses': '🟡', 'Selesai': '✅', 'Dibatalkan': '❌' }[p.status] || '⏳';
        result += `${statusEmoji} **${p.id}** — ${p.nama}\n`;
        result += `   Items: ${p.items}\n`;
        result += `   Total: ${p.total} | Status: ${p.status}\n`;
        result += `   Waktu: ${p.timestamp}\n\n`;
      }
      return result;
    } catch (e) {
      return `Gagal mengambil pesanan: ${e.message}`;
    }
  },
});

// ── Tool 4: Update Status Pesanan ──────────────────────────────────
export const updateStatusTool = new DynamicStructuredTool({
  name: 'update_status_pesanan',
  description: 'Update status pesanan. Status valid: "Diproses", "Disiapkan", "Siap Disajikan", "Selesai", "Dibatalkan".',
  schema: z.object({
    orderId: z.string().describe('ID pesanan, contoh: "ORD-ABC123"'),
    status: z.enum(['Diproses', 'Disiapkan', 'Siap Disajikan', 'Selesai', 'Dibatalkan'])
      .describe('Status baru pesanan'),
  }),
  func: async ({ orderId, status }) => {
    try {
      const result = await updateStatusPesanan(orderId, status);
      const emoji = { 'Diproses': '🟡', 'Disiapkan': '👨‍🍳', 'Siap Disajikan': '🍽️', 'Selesai': '✅', 'Dibatalkan': '❌' }[status] || '📌';
      return `${emoji} Status pesanan **${result.id}** berhasil diupdate menjadi **${result.status}**.`;
    } catch (e) {
      return `Gagal update status: ${e.message}`;
    }
  },
});

// ── Tool 5: Buat Reservasi ─────────────────────────────────────────
export const buatReservasiTool = new DynamicStructuredTool({
  name: 'buat_reservasi',
  description: 'Buat reservasi meja untuk pelanggan. Kumpulkan semua data yang diperlukan (nama, tanggal, jam, jumlah tamu, kontak) sebelum memanggil tool ini.',
  schema: z.object({
    nama: z.string().describe('Nama pelanggan yang membuat reservasi'),
    tanggal: z.string().describe('Tanggal reservasi format DD/MM/YYYY, contoh: "25/12/2025"'),
    jam: z.string().describe('Jam reservasi format HH:MM, contoh: "19:00"'),
    jumlahTamu: z.number().int().min(1).describe('Jumlah tamu yang akan hadir'),
    kontak: z.string().describe('Nomor telepon atau WhatsApp pelanggan'),
    catatan: z.string().optional().describe('Permintaan khusus, contoh: "anniversary dinner", "butuh kursi bayi"'),
  }),
  func: async ({ nama, tanggal, jam, jumlahTamu, kontak, catatan }) => {
    try {
      const result = await buatReservasi({ nama, tanggal, jam, jumlahTamu, kontak, catatan });
      return `🎉 Reservasi berhasil dibuat!\n\n` +
        `📋 **ID Reservasi:** ${result.id}\n` +
        `👤 **Nama:** ${nama}\n` +
        `📅 **Tanggal:** ${tanggal} pukul ${jam}\n` +
        `👥 **Jumlah Tamu:** ${jumlahTamu} orang\n` +
        `📞 **Kontak:** ${kontak}\n` +
        `✅ **Status:** ${result.status}\n` +
        (catatan ? `📝 **Catatan:** ${catatan}\n` : '') +
        `\nHarap tiba 10 menit sebelum waktu reservasi. Simpan ID reservasi untuk konfirmasi!`;
    } catch (e) {
      return `Gagal membuat reservasi: ${e.message}`;
    }
  },
});

// ── Tool 6: Cek Reservasi ──────────────────────────────────────────
export const cekReservasiTool = new DynamicStructuredTool({
  name: 'cek_reservasi',
  description: 'Cek daftar reservasi berdasarkan tanggal atau nama. Gunakan ini ketika pelanggan ingin konfirmasi atau mengecek reservasinya.',
  schema: z.object({
    tanggal: z.string().optional().describe('Tanggal untuk filter, contoh: "25/12/2025"'),
    nama: z.string().optional().describe('Nama pelanggan untuk filter reservasi'),
  }),
  func: async ({ tanggal, nama }) => {
    try {
      const reservasi = await getReservasi(tanggal, nama);
      if (reservasi.length === 0) return `Tidak ada reservasi ditemukan${tanggal ? ` untuk tanggal ${tanggal}` : ''}${nama ? ` atas nama ${nama}` : ''}.`;

      let result = `📅 **DAFTAR RESERVASI**\n\n`;
      for (const r of reservasi) {
        const statusEmoji = { 'Terkonfirmasi': '✅', 'Dibatalkan': '❌', 'Selesai': '🎉' }[r.status] || '📌';
        result += `${statusEmoji} **${r.id}** — ${r.nama}\n`;
        result += `   ${r.tanggal} pukul ${r.jam} | ${r.jumlah_tamu} tamu\n`;
        result += `   Kontak: ${r.kontak} | Status: ${r.status}\n`;
        if (r.catatan) result += `   Catatan: ${r.catatan}\n`;
        result += '\n';
      }
      return result;
    } catch (e) {
      return `Gagal mengambil reservasi: ${e.message}`;
    }
  },
});

// ── Tool 7: Batal Reservasi ────────────────────────────────────────
export const batalReservasiTool = new DynamicStructuredTool({
  name: 'batal_reservasi',
  description: 'Batalkan reservasi berdasarkan ID reservasi. Pastikan pelanggan sudah konfirmasi sebelum membatalkan.',
  schema: z.object({
    reservasiId: z.string().describe('ID reservasi yang akan dibatalkan, contoh: "RES-ABC123"'),
  }),
  func: async ({ reservasiId }) => {
    try {
      const result = await batalReservasi(reservasiId);
      return `❌ Reservasi **${result.id}** telah dibatalkan.\n\nJika ini tidak disengaja, silakan hubungi kami langsung untuk membuat reservasi baru.`;
    } catch (e) {
      return `Gagal membatalkan reservasi: ${e.message}`;
    }
  },
});

// Export semua tools sebagai array
export const restaurantTools = [
  lihatMenuTool,
  catatPesananTool,
  cekPesananTool,
  updateStatusTool,
  buatReservasiTool,
  cekReservasiTool,
  batalReservasiTool,
];
