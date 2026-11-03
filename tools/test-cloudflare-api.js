// Run against a local emulator: npx wrangler pages dev . --d1 DB --r2 PHOTOS --binding FIELD_SYNC_KEY=k --binding REPORT_ADMIN_KEY=adm --binding FIELD_SYNC_URL=<fake Apps Script>
// then: node tools/test-cloudflare-api.js [http://localhost:8788/api]   (migration checks need a fake Apps Script with old data)
const U = process.argv[2] || 'http://localhost:8788/api';
const call = async (action, body = {}, key = 'k') => (await fetch(U, { method: 'POST', body: JSON.stringify({ ...body, action, key }) })).json();
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  ok((await call('list', {}, 'bad')).error === 'unauthorized', 'wrong key refused');
  const now = Date.now();
  const job = { id: 'j1', status: 'open', created: now, updated: now, headerUpdated: now, statusUpdated: now, removed: [],
    header: { project: 'ทดสอบ', date: '2026-11-03' }, trucks: [{ id: 'a', do: '0372611030001', truck: '1', volume: '7', created: now, updated: now }] };
  let r = await call('save', { job }); ok(r.ok && r.job.trucks.length === 1, 'save new job');
  // second device adds a truck to the same job (merge)
  const j2 = { ...job, updated: now + 5, trucks: [{ id: 'b', do: '0372611030002', truck: '2', volume: '7', created: now + 5, updated: now + 5 }] };
  r = await call('save', { job: j2 }); ok(r.ok && r.job.trucks.length === 2, 'two devices merge → 2 trucks');
  r = await call('list'); ok(r.ok && r.jobs.length === 1 && r.jobs[0].stub && r.jobs[0].truckCount === 2 && r.jobs[0].received === 14, 'list gives stub with count/received');
  r = await call('get', { id: 'j1' }); ok(r.job.trucks.map(t => t.id).join() === 'a,b', 'get full job');
  // D/O used by another job
  const other = { id: 'j2', created: now, updated: now, header: { project: 'อีกงาน', date: '2026-11-03' }, trucks: [{ id: 'c', do: '0372611030002', created: now, updated: now }], removed: [] };
  r = await call('save', { job: other }); ok(!r.ok && r.error === 'duplicate' && r.conflict.project === 'ทดสอบ' && r.conflict.no === 2, 'D/O used elsewhere refused (' + JSON.stringify(r.conflict) + ')');
  r = await call('checkDO', { do: '0372611030001', jobId: 'zzz' }); ok(r.hit && r.hit.no === 1, 'checkDO finds owner');
  r = await call('checkDO', { do: '0372611030001', jobId: 'j1' }); ok(r.hit === null, 'checkDO ignores own job');
  // remove truck b (tombstone) → its D/O is free again
  r = await call('save', { job: { ...job, updated: now + 9, trucks: [], removed: [{ id: 'b', updated: now + 9 }] } }); ok(r.ok && r.job.trucks.length === 1, 'truck removed by tombstone');
  r = await call('save', { job: other }); ok(r.ok, 'freed D/O can be used by another job');
  r = await call('report', { from: '2026-11-01', to: '2026-11-30' }); ok(r.jobs.length === 2 && r.jobs.every(j => Array.isArray(j.trucks)), 'report with trucks');
  await call('delete', { id: 'j2' }); r = await call('save', { job: other }); ok(r.error === 'deleted', 'deleted job stays deleted');
  r = await call('checkDO', { do: '0372611030002', jobId: '' }); ok(r.hit === null, 'deleted job frees its D/O');
  // photos
  const data = Buffer.from('fake-jpeg-bytes').toString('base64');
  r = await call('photoUpload', { id: 'p-site-1', project: 'Langsuan Residence', date: '2026-11-03', kind: 'site', do: '0372611030001', takenAt: 1, data }); ok(r.ok, 'photo upload');
  r = await call('photoUpload', { id: 'p-pr-1', project: 'Langsuan Residence', date: '2026-11-03', kind: 'printout', do: '0372611030001', data }); ok(r.error === 'not_admin', 'printout needs admin');
  r = await call('photoUpload', { id: 'p-pr-1', project: 'Langsuan Residence', date: '2026-11-03', kind: 'printout', do: '0372611030001', data, adminKey: 'adm' }); ok(r.ok, 'printout by admin');
  r = await call('photoList', { project: 'Langsuan Residence', date: '2026-11-03' }); ok(r.photos.length === 1, 'staff list hides printout');
  r = await call('photoList', { project: 'Langsuan Residence', date: '2026-11-03', adminKey: 'adm' }); ok(r.photos.length === 2, 'admin list shows printout');
  r = await call('photoGet', { id: 'p-site-1' }); ok(r.ok && Buffer.from(r.data, 'base64').toString() === 'fake-jpeg-bytes', 'photo bytes round-trip');
  r = await call('photoGet', { id: 'p-pr-1' }); ok(!r.ok, 'staff cannot fetch printout');
  r = await call('photoDelete', { id: 'p-site-1' }); r = await call('photoGet', { id: 'p-site-1' }); ok(!r.ok, 'photo deleted');
  // forwarded to Apps Script
  r = await call('mailReport', { adminKey: 'adm' }); ok(r.mailed, 'mail forwarded (admin)');
  r = await call('reportAdminCheck', { adminKey: 'adm' }); ok(r.ok, 'admin check');
  // migration
  r = await call('migrateFetch'); ok(r.error === 'not_admin', 'migrate needs admin');
  r = await call('migrateFetch', { adminKey: 'adm' }); ok(r.ok && r.jobs.length === 2, 'migrate fetch from sheet');
  for (const j of r.jobs) { const x = await call('importJob', { job: j, adminKey: 'adm' }); ok(x.ok, 'import ' + j.id + ' clash=' + JSON.stringify(x.clash)); }
  r = await call('get', { id: 'old2' }); ok(r.job.trucks.length === 2 && r.job.status === 'open', 'imported job readable');
  r = await call('checkDO', { do: '0042611010002', jobId: '' }); ok(r.hit && r.hit.jobId === 'old2', 'imported D/O indexed');
  r = await call('migratePhotoList', { project: 'Langsuan Residence', date: '2026-10-30', adminKey: 'adm' }); ok(r.photos.length === 1, 'old photo list');
  const x = await call('importPhoto', { photo: r.photos[0], adminKey: 'adm' }); ok(x.ok, 'old photo copied to R2');
  r = await call('photoGet', { id: 'ph-old-1', adminKey: 'adm' }); ok(r.ok && r.data.length > 20, 'copied photo readable');
  r = await call('backup', { adminKey: 'adm' }); ok(r.ok && r.jobs >= 3, 'backup to R2 ' + JSON.stringify(r));
})();
