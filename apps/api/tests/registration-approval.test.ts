import { beforeAll, describe, expect, it } from 'vitest'
import { account, admin, api, createTestApp, register, signIn, signInResponse, type TestApp } from './helpers.ts'

let t: TestApp
beforeAll(async () => {
  t = await createTestApp()
}, 60_000)

describe('registration and admin approval', () => {
  it('a new account cannot sign in until an admin approves it', async () => {
    const sam = account('sam')
    expect((await register(t, sam)).ok).toBe(true)

    const res = await signInResponse(t, sam)
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('waiting for admin approval')
  })

  it('an admin email is approved automatically and has the admin role', async () => {
    const cookie = await admin(t)
    const me = await (await api(t, cookie).get('/me')).json()
    expect(me.user).toMatchObject({ role: 'admin', status: 'approved' })
  })

  it('an admin approves a pending account, then that person can sign in by username', async () => {
    const lee = account('lee')
    await register(t, lee)
    const adminCookie = await admin(t).catch(async () => (await signIn(t, { username: 'boss', password: 'correct-horse-battery' }))!)

    const pending = await (await api(t, adminCookie).get('/admin/users?status=pending')).json()
    const row = pending.users.find((u: { email: string }) => u.email === lee.email)
    expect(row).toBeTruthy()

    expect((await api(t, adminCookie).post(`/admin/users/${row.id}/approve`)).status).toBe(200)

    const cookie = await signIn(t, lee)
    expect(cookie).toBeTruthy()
    const me = await (await api(t, cookie!).get('/me')).json()
    expect(me.user).toMatchObject({ email: lee.email, role: 'member', status: 'approved' })
  })

  it('a rejected account cannot sign in', async () => {
    const kim = account('kim')
    await register(t, kim)
    const adminCookie = (await signIn(t, { username: 'boss', password: 'correct-horse-battery' }))!
    const users = await (await api(t, adminCookie).get('/admin/users?status=pending')).json()
    const row = users.users.find((u: { email: string }) => u.email === kim.email)

    await api(t, adminCookie).post(`/admin/users/${row.id}/reject`)

    const res = await signInResponse(t, kim)
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('declined')
  })

  it('a member cannot use the admin endpoints', async () => {
    const lee = account('lee')
    const cookie = (await signIn(t, lee))!
    expect((await api(t, cookie).get('/admin/users')).status).toBe(403)
  })

  it('an admin cannot change their own status', async () => {
    const adminCookie = (await signIn(t, { username: 'boss', password: 'correct-horse-battery' }))!
    const me = await (await api(t, adminCookie).get('/me')).json()
    expect((await api(t, adminCookie).post(`/admin/users/${me.user.id}/reject`)).status).toBe(400)
  })

  it('requests without a session get 401', async () => {
    const res = await t.app.request('/v1/tasks')
    expect(res.status).toBe(401)
  })

  it('rejects a password that is too short', async () => {
    const res = await register(t, { email: 'tiny@example.com', username: 'tiny', password: 'short' })
    expect(res.ok).toBe(false)
  })
})
