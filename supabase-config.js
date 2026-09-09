/**
 * ==========================================================================
 * KONFIGURASI SUPABASE
 * Isi 2 nilai di bawah ini dengan milik project Supabase Anda
 * (Settings -> API -> Project URL & anon public key)
 * ==========================================================================
 */
const SUPABASE_URL = 'https://mpajglsilimqsodpxmyj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wYWpnbHNpbGltcXNvZHB4bXlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NzUzMjgsImV4cCI6MjEwNDQ1MTMyOH0.-WJq0WrYVdo96Djbe08ug894SdF36T6gEegR54Z_bf0';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* =========================================================================
 * AUTENTIKASI (LOGIN ADMIN)
 * ========================================================================= */

/**
 * Wajib dipanggil di awal setiap halaman (index.html & jadwal.html).
 * Jika belum login, otomatis redirect ke login.html.
 */
async function wajibLogin() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  return session;
}

async function loginAdmin(email, password) {
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

async function logoutAdmin() {
  await sb.auth.signOut();
  window.location.href = 'login.html';
}

/* =========================================================================
 * SHIM PEMANGGILAN API (meniru gaya google.script.run agar HTML lama
 * tidak perlu ditulis ulang total)
 *
 * Pemakaian di HTML (sama seperti sebelumnya, hanya "google.script.run"
 * diganti "apiCall()"):
 *   apiCall().withSuccessHandler(cb).withFailureHandler(errCb).getInitialData(id);
 * ========================================================================= */
function apiCall() {
  const chain = {
    _success: () => {},
    _failure: (err) => console.error('API error:', err),
    withSuccessHandler(fn) { chain._success = fn; return chain; },
    withFailureHandler(fn) { chain._failure = fn; return chain; }
  };

  const methodNames = [
    'getInitialData', 'addMaster', 'updateMaster', 'deleteMaster',
    'addSchedule', 'updateSchedule', 'deleteSchedule', 'deleteAllSchedules',
    'clearAllData', 'getKonteksList', 'createNewKonteks', 'deleteKonteks',
    'getKonteksInfo', 'salinDataMaster'
  ];

  methodNames.forEach(name => {
    chain[name] = function (...args) {
      Promise.resolve(window.__api[name](...args))
        .then(res => chain._success(res))
        .catch(err => chain._failure(err.message || String(err)));
      return chain;
    };
  });

  return chain;
}

/* =========================================================================
 * MAPPING snake_case (Supabase) <-> camelCase (dipakai di HTML/JS lama)
 * ========================================================================= */
function mapJamOut(row) {
  return { id: row.id, jamMulai: row.jam_mulai, jamSelesai: row.jam_selesai, label: row.label };
}
function mapMataKuliahOut(row) {
  return { id: row.id, kode: row.kode, nama: row.nama, sks: row.sks, semester: row.semester };
}
function mapJadwalOut(row) {
  return {
    id: row.id,
    semester: row.semester,
    hari: row.hari,
    jamMulai: row.jam_mulai,
    jamSelesai: row.jam_selesai,
    kodeMk: row.kode_mk,
    namaMk: row.nama_mk,
    sks: row.sks,
    dosen: row.dosen,
    kelas: row.kelas,
    ruangan: row.ruangan,
    status: row.status,
    keterangan: row.keterangan
  };
}

// type (dari UI) -> nama tabel Supabase
const TABLE_MAP = {
  dosen: 'dosen',
  mata_kuliah: 'mata_kuliah',
  jam: 'jam',
  kelas: 'kelas',
  ruangan: 'ruangan'
};

/* =========================================================================
 * IMPLEMENTASI API (pengganti fungsi-fungsi di code.gs)
 * ========================================================================= */
window.__api = {

  /* ---------- KONTEKS (Tahun Ajaran + Prodi) ---------- */

  async getKonteksList() {
    try {
      const { data, error } = await sb.from('konteks').select('*')
        .order('tahun_ajaran').order('prodi');
      if (error) throw error;
      return {
        success: true,
        data: data.map(k => ({ id: k.id, tahunAjaran: k.tahun_ajaran, prodi: k.prodi }))
      };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },

  async getKonteksInfo(konteksId) {
    try {
      const { data, error } = await sb.from('konteks').select('*').eq('id', konteksId).single();
      if (error) throw error;
      return { success: true, data: { id: data.id, tahunAjaran: data.tahun_ajaran, prodi: data.prodi } };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },

  async createNewKonteks(tahunAjaran, prodi, sourceKonteksId, salinJadwalJuga) {
    try {
      tahunAjaran = String(tahunAjaran || '').trim();
      prodi = String(prodi || '').trim();
      if (!tahunAjaran || !prodi) {
        return { success: false, error: 'Tahun Ajaran dan Program Studi wajib diisi.' };
      }

      const { data: existing } = await sb.from('konteks').select('id')
        .ilike('tahun_ajaran', tahunAjaran).ilike('prodi', prodi);
      if (existing && existing.length > 0) {
        return { success: false, error: 'Kombinasi Tahun Ajaran dan Program Studi ini sudah ada.' };
      }

      const { data, error } = await sb.from('konteks')
        .insert({ tahun_ajaran: tahunAjaran, prodi: prodi })
        .select().single();
      if (error) throw error;

      let pesanTambahan = '';
      if (sourceKonteksId) {
        const salin = await this.salinDataMaster(sourceKonteksId, data.id, !!salinJadwalJuga);
        if (!salin.success) {
          pesanTambahan = ` (Konteks berhasil dibuat, tapi salin data gagal: ${salin.error})`;
        } else if (salinJadwalJuga) {
          pesanTambahan = ' Data Master & Jadwal berhasil disalin dari konteks sebelumnya.';
        } else {
          pesanTambahan = ' Data Master berhasil disalin dari konteks sebelumnya — Jadwal dibiarkan kosong.';
        }
      }

      return {
        success: true,
        message: 'Program Studi & Tahun Ajaran baru berhasil dibuat.' + pesanTambahan,
        data: { id: data.id, tahunAjaran: data.tahun_ajaran, prodi: data.prodi }
      };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },

  /**
   * Menyalin Data Master (dosen, mata_kuliah, jam, kelas, ruangan) dari satu
   * konteks ke konteks lain. Kalau salinJadwalJuga = true, tabel jadwal ikut disalin.
   */
  async salinDataMaster(sourceKonteksId, targetKonteksId, salinJadwalJuga) {
    try {
      const tabelDanKolom = {
        dosen: ['nama'],
        mata_kuliah: ['kode', 'nama', 'sks', 'semester'],
        jam: ['jam_mulai', 'jam_selesai', 'label'],
        kelas: ['nama'],
        ruangan: ['nama']
      };

      for (const [table, kolom] of Object.entries(tabelDanKolom)) {
        const { data: rows, error: selErr } = await sb.from(table).select(kolom.join(','))
          .eq('konteks_id', sourceKonteksId);
        if (selErr) throw selErr;
        if (rows && rows.length > 0) {
          const insertRows = rows.map(r => ({ ...r, konteks_id: targetKonteksId }));
          const { error: insErr } = await sb.from(table).insert(insertRows);
          if (insErr) throw insErr;
        }
      }

      if (salinJadwalJuga) {
        const kolomJadwal = ['semester', 'hari', 'jam_mulai', 'jam_selesai', 'kode_mk', 'nama_mk', 'sks', 'dosen', 'kelas', 'ruangan', 'status', 'keterangan'];
        const { data: rowsJadwal, error: selErr } = await sb.from('jadwal').select(kolomJadwal.join(','))
          .eq('konteks_id', sourceKonteksId);
        if (selErr) throw selErr;
        if (rowsJadwal && rowsJadwal.length > 0) {
          const insertJadwal = rowsJadwal.map(r => ({ ...r, konteks_id: targetKonteksId }));
          const { error: insErrJadwal } = await sb.from('jadwal').insert(insertJadwal);
          if (insErrJadwal) throw insErrJadwal;
        }
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },

  async deleteKonteks(konteksId) {
    try {
      const { data: info } = await sb.from('konteks').select('*').eq('id', konteksId).single();
      const { error } = await sb.from('konteks').delete().eq('id', konteksId);
      if (error) throw error;
      return {
        success: true,
        message: info
          ? `Tahun Ajaran "${info.tahun_ajaran}" - Prodi "${info.prodi}" beserta seluruh datanya berhasil dihapus.`
          : 'Data berhasil dihapus.'
      };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },

  /* ---------- DATA UTAMA HALAMAN JADWAL ---------- */

  async getInitialData(konteksId) {
    try {
      const [dosenRes, mkRes, jamRes, kelasRes, ruanganRes, jadwalRes] = await Promise.all([
        sb.from('dosen').select('*').eq('konteks_id', konteksId).order('nama'),
        sb.from('mata_kuliah').select('*').eq('konteks_id', konteksId).order('nama'),
        sb.from('jam').select('*').eq('konteks_id', konteksId).order('jam_mulai'),
        sb.from('kelas').select('*').eq('konteks_id', konteksId).order('nama'),
        sb.from('ruangan').select('*').eq('konteks_id', konteksId).order('nama'),
        sb.from('jadwal').select('*').eq('konteks_id', konteksId)
      ]);
      const errs = [dosenRes, mkRes, jamRes, kelasRes, ruanganRes, jadwalRes].find(r => r.error);
      if (errs) throw errs.error;

      return {
        success: true,
        masters: {
          dosen: dosenRes.data,
          mataKuliah: mkRes.data.map(mapMataKuliahOut),
          jam: jamRes.data.map(mapJamOut),
          kelas: kelasRes.data,
          ruangan: ruanganRes.data
        },
        schedules: jadwalRes.data.map(mapJadwalOut)
      };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },

  /* ---------- MASTER DATA (dosen, mata_kuliah, jam, kelas, ruangan) ---------- */

  async addMaster(type, data, konteksId) {
    try {
      const table = TABLE_MAP[type];
      if (!table) throw new Error('Tipe master data tidak valid');

      let insertRow = { konteks_id: konteksId };
      let dupQuery = sb.from(table).select('id').eq('konteks_id', konteksId);

      if (type === 'dosen' || type === 'kelas' || type === 'ruangan') {
        insertRow.nama = data.nama;
        dupQuery = dupQuery.ilike('nama', data.nama);
      } else if (type === 'mata_kuliah') {
        insertRow = { ...insertRow, kode: String(data.kode), nama: data.nama, sks: Number(data.sks), semester: data.semester };
        dupQuery = dupQuery.ilike('kode', data.kode).eq('semester', data.semester);
      } else if (type === 'jam') {
        const label = `${data.jamMulai} - ${data.jamSelesai}`;
        insertRow = { ...insertRow, jam_mulai: String(data.jamMulai), jam_selesai: String(data.jamSelesai), label };
        dupQuery = dupQuery.eq('jam_mulai', data.jamMulai).eq('jam_selesai', data.jamSelesai);
      }

      const { data: dup } = await dupQuery;
      if (dup && dup.length > 0) {
        return { success: false, error: 'Data master sudah ada!' };
      }

      const { data: inserted, error } = await sb.from(table).insert(insertRow).select().single();
      if (error) throw error;

      let newRecord;
      if (type === 'jam') newRecord = mapJamOut(inserted);
      else if (type === 'mata_kuliah') newRecord = mapMataKuliahOut(inserted);
      else newRecord = inserted;

      return { success: true, message: 'Data master berhasil ditambahkan!', data: newRecord };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },

  async updateMaster(type, id, data) {
    try {
      const table = TABLE_MAP[type];
      let updateRow = {};

      if (type === 'dosen' || type === 'kelas' || type === 'ruangan') {
        updateRow.nama = data.nama;
      } else if (type === 'mata_kuliah') {
        updateRow = { kode: String(data.kode), nama: data.nama, sks: Number(data.sks), semester: data.semester };
      } else if (type === 'jam') {
        const label = `${data.jamMulai} - ${data.jamSelesai}`;
        updateRow = { jam_mulai: String(data.jamMulai), jam_selesai: String(data.jamSelesai), label };
      }

      const { error } = await sb.from(table).update(updateRow).eq('id', id);
      if (error) throw error;

      return { success: true, message: 'Data master berhasil diubah!' };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },

  async deleteMaster(type, id) {
    try {
      const table = TABLE_MAP[type];
      const { error } = await sb.from(table).delete().eq('id', id);
      if (error) throw error;
      return { success: true, message: 'Data master berhasil dihapus!' };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },

  /* ---------- JADWAL ---------- */

  async _cekBentrok(scheduleData, konteksId, excludeId) {
    const { data, error } = await sb.rpc('cek_bentrok', {
      p_konteks_id: konteksId,
      p_hari: scheduleData.hari,
      p_jam_mulai: String(scheduleData.jamMulai),
      p_jam_selesai: String(scheduleData.jamSelesai),
      p_dosen: scheduleData.dosen,
      p_kelas: scheduleData.kelas,
      p_ruangan: scheduleData.ruangan,
      p_exclude_id: excludeId || null
    });
    if (error) throw error;
    return {
      hasConflict: data && data.length > 0,
      details: (data || []).map(d => d.pesan)
    };
  },

  async addSchedule(scheduleData, konteksId) {
    try {
      if (!scheduleData.hari || !scheduleData.jamMulai || !scheduleData.jamSelesai ||
          !scheduleData.kodeMk || !scheduleData.dosen || !scheduleData.kelas || !scheduleData.ruangan) {
        return { success: false, error: 'Semua field wajib diisi!' };
      }

      const conflict = await this._cekBentrok(scheduleData, konteksId, null);
      if (conflict.hasConflict) {
        return {
          success: false, isConflict: true,
          message: 'Jadwal tidak dapat disimpan karena terjadi bentrok.',
          details: conflict.details
        };
      }

      const insertRow = {
        konteks_id: konteksId,
        semester: scheduleData.semester || '-',
        hari: scheduleData.hari,
        jam_mulai: String(scheduleData.jamMulai),
        jam_selesai: String(scheduleData.jamSelesai),
        kode_mk: String(scheduleData.kodeMk),
        nama_mk: scheduleData.namaMk || '-',
        sks: Number(scheduleData.sks) || 0,
        dosen: scheduleData.dosen,
        kelas: scheduleData.kelas,
        ruangan: scheduleData.ruangan,
        status: 'BEBAS',
        keterangan: scheduleData.keterangan || '-'
      };

      const { data: inserted, error } = await sb.from('jadwal').insert(insertRow).select().single();
      if (error) throw error;

      return { success: true, message: 'Jadwal berhasil disimpan.', schedule: mapJadwalOut(inserted) };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },

  async updateSchedule(id, scheduleData, konteksId) {
    try {
      const conflict = await this._cekBentrok(scheduleData, konteksId, id);
      if (conflict.hasConflict) {
        return {
          success: false, isConflict: true,
          message: 'Jadwal tidak dapat disimpan karena terjadi bentrok.',
          details: conflict.details
        };
      }

      const updateRow = {
        semester: scheduleData.semester || '-',
        hari: scheduleData.hari,
        jam_mulai: String(scheduleData.jamMulai),
        jam_selesai: String(scheduleData.jamSelesai),
        kode_mk: String(scheduleData.kodeMk),
        nama_mk: scheduleData.namaMk || '-',
        sks: Number(scheduleData.sks) || 0,
        dosen: scheduleData.dosen,
        kelas: scheduleData.kelas,
        ruangan: scheduleData.ruangan,
        keterangan: scheduleData.keterangan || '-'
      };

      const { data: updated, error } = await sb.from('jadwal').update(updateRow).eq('id', id).select().single();
      if (error) throw error;

      return { success: true, message: 'Jadwal berhasil diperbarui.', schedule: mapJadwalOut(updated) };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },

  async deleteSchedule(id) {
    try {
      const { error } = await sb.from('jadwal').delete().eq('id', id);
      if (error) throw error;
      return { success: true, message: 'Jadwal berhasil dihapus.' };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },

  async deleteAllSchedules(konteksId) {
    try {
      const { error } = await sb.from('jadwal').delete().eq('konteks_id', konteksId);
      if (error) throw error;
      return { success: true, message: 'Semua jadwal berhasil dihapus.' };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },

  async clearAllData(konteksId) {
    try {
      await Promise.all(
        ['dosen', 'mata_kuliah', 'jam', 'kelas', 'ruangan', 'jadwal']
          .map(t => sb.from(t).delete().eq('konteks_id', konteksId))
      );
      return { success: true, message: 'Seluruh data berhasil dihapus!' };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }
};
