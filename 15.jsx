/*
UMKM Donasi Web App (single-file React component)

Features:
- Tambah / edit / hapus project donasi
- Upload gambar bukti dan simpan ke folder "image" pada repo GitHub via GitHub REST API (user supplies Personal Access Token tiap session)
- Jika token tidak diisi, app fallback ke localStorage (untuk testing)
- Projects stored in repo at data/projects.json (if token provided) or localStorage

How to use:
1. Instalasi lokal (direkomendasikan):
   - Buat project React (Vite) atau gunakan Create React App, lalu ganti src/App.jsx dengan konten file ini.
   - npm install
   - npm run dev / start

2. Menyimpan gambar ke GitHub:
   - Buat Personal Access Token (classic) di GitHub: scope repo -> untuk repo private/public, at least repo or public_repo depending repo visibility.
   - Masukkan Owner (username/org), Repo name, Branch (default: main/master), dan token ketika diminta di UI. Token tidak disimpan di server.

3. Deploy ke GitHub Pages:
   - Jika ingin berjalan di GitHub Pages, Anda perlu menyimpan token di client (tidak aman) atau menggunakan server backend. Untuk production, buat backend kecil yang menerima upload dan melakukan commit ke repo menggunakan token yang aman.

Security notes:
- Menyimpan token di browser berarti token bisa disalahgunakan. Gunakan token dengan scope terbatas, dan hapus setelah tidak dipakai.
- Untuk penggunaan publik, buat endpoint server untuk menangani commit.


Below is the React component (export default App). Paste into src/App.jsx
*/

import React, { useEffect, useState } from "react";

// Helper to call GitHub API to create/update file
async function githubPutFile({ owner, repo, path, contentBase64, message, branch, token }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = { message, content: contentBase64 };
  if (branch) body.branch = branch;

  // Check if file exists to include sha (for update)
  const getUrl = `${url}` + (branch ? `?ref=${encodeURIComponent(branch)}` : "");
  let existingSha = null;
  const getResp = await fetch(getUrl, { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" } });
  if (getResp.ok) {
    const j = await getResp.json();
    if (j && j.sha) existingSha = j.sha;
  }
  if (existingSha) body.sha = existingSha;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error((json && json.message) || `GitHub API error ${resp.status}`);
  return json;
}

function toBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result.split(",", 2)[1];
      res(b64);
    };
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [projects, setProjects] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: "", target: "", description: "", collected: 0 });
  const [file, setFile] = useState(null);
  const [statusMsg, setStatusMsg] = useState("");

  // GitHub settings
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [token, setToken] = useState("");

  const PROJECTS_PATH = "data/projects.json"; // where projects are stored in repo

  useEffect(() => {
    // try load projects from GitHub if token provided, else localStorage
    if (token && owner && repo) {
      fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(PROJECTS_PATH)}?ref=${encodeURIComponent(branch)}`, {
        headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
      })
        .then((r) => r.json())
        .then((j) => {
          if (j && j.content) {
            const txt = atob(j.content.replace(/\n/g, ""));
            try {
              setProjects(JSON.parse(txt));
              setStatusMsg("Loaded projects from GitHub repo.");
            } catch (e) {
              console.error(e);
              setStatusMsg("Failed parse projects.json in repo.");
            }
          }
        })
        .catch(() => {
          setStatusMsg("No projects file found in repo — will use localStorage until you save.");
          const local = localStorage.getItem("umkm_projects");
          if (local) setProjects(JSON.parse(local));
        });
    } else {
      const local = localStorage.getItem("umkm_projects");
      if (local) setProjects(JSON.parse(local));
    }
  }, [token, owner, repo, branch]);

  useEffect(() => {
    localStorage.setItem("umkm_projects", JSON.stringify(projects));
  }, [projects]);

  function resetForm() {
    setForm({ title: "", target: "", description: "", collected: 0 });
    setFile(null);
    setEditing(null);
  }

  async function saveProjectsToGitHub(currentProjects) {
    if (!token || !owner || !repo) throw new Error("Missing GitHub credentials");
    const content = btoa(JSON.stringify(currentProjects, null, 2));
    const res = await githubPutFile({ owner, repo, path: PROJECTS_PATH, contentBase64: content, message: "Update projects.json via web app", branch, token });
    return res;
  }

  async function handleAddOrUpdate(e) {
    e.preventDefault();
    const now = Date.now();
    let updated = [...projects];
    if (editing != null) {
      // update existing
      updated = updated.map((p) => (p.id === editing ? { ...p, ...form, updatedAt: now } : p));
    } else {
      const newProj = { id: `p_${now}`, createdAt: now, updatedAt: now, ...form, image: null };
      updated.unshift(newProj);
    }

    // if there's a file, upload it first
    try {
      if (file && token && owner && repo) {
        setStatusMsg("Uploading image to GitHub...");
        const b64 = await toBase64(file);
        const filename = `image/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        await githubPutFile({ owner, repo, path: filename, contentBase64: b64, message: `Upload image ${filename}`, branch, token });
        // set image url raw
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filename}`;
        if (editing != null) updated = updated.map((p) => (p.id === editing ? { ...p, ...form, image: rawUrl, updatedAt: now } : p));
        else updated[0].image = rawUrl;
        setStatusMsg("Image uploaded.");
      } else if (file && !(token && owner && repo)) {
        setStatusMsg("No GitHub credentials: image won't be uploaded to repo (saved only locally).");
      }

      setProjects(updated);

      // attempt to save projects.json to repo
      if (token && owner && repo) {
        setStatusMsg("Saving projects.json to GitHub...");
        await saveProjectsToGitHub(updated);
        setStatusMsg("Saved projects.json to GitHub.");
      } else {
        setStatusMsg("Saved locally (no GitHub credentials).");
      }

      resetForm();
    } catch (err) {
      console.error(err);
      setStatusMsg(`Error: ${err.message}`);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Hapus project ini?")) return;
    const updated = projects.filter((p) => p.id !== id);
    setProjects(updated);
    try {
      if (token && owner && repo) {
        await saveProjectsToGitHub(updated);
        setStatusMsg("Deleted and saved to GitHub.");
      } else setStatusMsg("Deleted locally.");
    } catch (e) {
      setStatusMsg(`Error saving after delete: ${e.message}`);
    }
  }

  function startEdit(p) {
    setEditing(p.id);
    setForm({ title: p.title, target: p.target, description: p.description, collected: p.collected || 0 });
    setFile(null);
  }

  return (
    <div className="min-h-screen p-4 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">UMKM Donasi — Web App</h1>
        <p className="text-sm mb-4">Tambah project donasi, upload gambar, dan simpan ke folder <code>image/</code> pada repo GitHub Anda.</p>

        <div className="mb-4 p-4 bg-white rounded shadow">
          <h2 className="font-semibold">Pengaturan GitHub (opsional)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mt-2">
            <input className="p-2 border rounded" placeholder="Owner (username/org)" value={owner} onChange={(e) => setOwner(e.target.value)} />
            <input className="p-2 border rounded" placeholder="Repo name" value={repo} onChange={(e) => setRepo(e.target.value)} />
            <input className="p-2 border rounded" placeholder="Branch (main)" value={branch} onChange={(e) => setBranch(e.target.value)} />
            <input className="p-2 border rounded" placeholder="Personal Access Token (paste here)" value={token} onChange={(e) => setToken(e.target.value)} />
          </div>
          <p className="text-xs text-gray-600 mt-2">Token hanya dipakai di browser Anda saat ini. Untuk keamanan produksi, gunakan backend.</p>
        </div>

        <form onSubmit={handleAddOrUpdate} className="mb-6 p-4 bg-white rounded shadow">
          <h2 className="font-semibold mb-2">{editing ? "Edit Project" : "Tambah Project"}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input required className="p-2 border rounded" placeholder="Judul project" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input required className="p-2 border rounded" placeholder="Target (nominal)" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
            <textarea required className="p-2 border rounded sm:col-span-2" placeholder="Deskripsi" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <input type="number" className="p-2 border rounded" placeholder="Terkumpul" value={form.collected} onChange={(e) => setForm({ ...form, collected: Number(e.target.value) })} />
            <div>
              <label className="block text-sm mb-1">Upload gambar (opsional):</label>
              <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0] || null)} />
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">{editing ? "Simpan Perubahan" : "Tambah Project"}</button>
            <button type="button" onClick={resetForm} className="px-4 py-2 border rounded">Batal</button>
          </div>
        </form>

        <div className="grid gap-3">
          {projects.length === 0 && <div className="p-4 bg-white rounded">Belum ada project.</div>}
          {projects.map((p) => (
            <div key={p.id} className="p-4 bg-white rounded shadow flex gap-4 items-start">
              <div style={{ width: 120, height: 80, background: '#f3f3f3' }} className="flex items-center justify-center overflow-hidden rounded">
                {p.image ? (
                  // show image
                  <img src={p.image} alt={p.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span className="text-xs text-gray-500">No image</span>
                )}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold">{p.title}</h3>
                <p className="text-sm text-gray-600">{p.description}</p>
                <p className="text-sm mt-1">Target: {p.target} • Terkumpul: {p.collected}</p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => startEdit(p)} className="px-3 py-1 border rounded text-sm">Edit</button>
                  <button onClick={() => handleDelete(p.id)} className="px-3 py-1 border rounded text-sm">Hapus</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 text-sm text-gray-700">Status: {statusMsg}</div>

        <div className="mt-6 p-4 bg-white rounded text-xs text-gray-600">
          <strong>Catatan cepat:</strong>
          <ul className="list-disc pl-5 mt-2">
            <li>Jika ingin gambar disimpan ke folder <code>image/</code> pada repo, masukkan GitHub owner, repo, branch, dan token.</li>
            <li>Projects disimpan ke <code>data/projects.json</code> di repo saat token disediakan.</li>
            <li>Untuk deployment aman: buat server backend untuk menerima upload dan commit ke GitHub menggunakan token yang disimpan aman.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
