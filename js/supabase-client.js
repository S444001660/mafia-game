// ============================================================
// SUPABASE CLIENT - مشترك بين جميع الصفحات
// ضع هذا الملف في كل صفحة:
//   <script src="js/supabase-client.js"></script>
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// !! ضع بيانات مشروعك من Supabase Dashboard هنا !!
const SUPABASE_URL  = 'https://hdnmvpldhrosianqthlu.supabase.co';
const SUPABASE_ANON = 'sb_publishable_pqG_RG3ntMuC3VdOJG45cA_ZZ_Z1JGB';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ============================================================
// AUTH HELPERS
// ============================================================

export async function signUp(email, password, username, avatar = '🦁') {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { username, avatar } }
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
  location.href = 'index.html';
}

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function requireAuth() {
  const user = await getUser();
  if (!user) {
    location.href = 'index.html';
    return null;
  }
  return user;
}

// ============================================================
// ROOM HELPERS
// ============================================================

export async function createRoom(hostId, settings = {}) {
  // Generate unique code
  let code, exists = true;
  while (exists) {
    code = generateCode();
    const { data } = await supabase.from('rooms').select('id').eq('code', code).single();
    exists = !!data;
  }

  const { data: room, error } = await supabase
    .from('rooms')
    .insert({ code, host_id: hostId, settings: { ...defaultSettings(), ...settings } })
    .select()
    .single();
  if (error) throw error;

  // Host joins as seat 1
  await joinRoom(room.id, hostId);
  return room;
}

export async function joinRoom(roomId, playerId) {
  // Find next available seat
  const { data: players } = await supabase
    .from('room_players')
    .select('seat')
    .eq('room_id', roomId)
    .order('seat');

  const seats = players.map(p => p.seat);
  let seat = 1;
  while (seats.includes(seat)) seat++;

  const { error } = await supabase
    .from('room_players')
    .insert({ room_id: roomId, player_id: playerId, seat });
  if (error && error.code !== '23505') throw error; // ignore duplicate
}

export async function getRoomByCode(code) {
  const { data, error } = await supabase
    .from('rooms')
    .select(`*, room_players(*, profiles(*))`)
    .eq('code', code.toUpperCase())
    .single();
  if (error) throw error;
  return data;
}

export async function leaveRoom(roomId, playerId) {
  await supabase.from('room_players').delete()
    .eq('room_id', roomId).eq('player_id', playerId);
}

export async function setReady(roomId, playerId, ready) {
  await supabase.from('room_players')
    .update({ is_ready: ready })
    .eq('room_id', roomId).eq('player_id', playerId);
}

// ============================================================
// GAME HELPERS
// ============================================================

export async function getGameState(gameId) {
  const { data, error } = await supabase
    .from('game_state')
    .select('*')
    .eq('game_id', gameId);
  if (error) throw error;
  return data;
}

export async function submitNightAction(gameId, playerId, actionType, targetId, nightNum) {
  const { error } = await supabase.from('night_actions')
    .upsert({ game_id: gameId, player_id: playerId, action_type: actionType, target_id: targetId, night_num: nightNum },
             { onConflict: 'game_id,player_id,night_num' });
  if (error) throw error;
}

export async function submitVote(gameId, voterId, targetId, dayNum) {
  const { error } = await supabase.from('votes')
    .upsert({ game_id: gameId, voter_id: voterId, target_id: targetId, day_num: dayNum },
             { onConflict: 'game_id,voter_id,day_num' });
  if (error) throw error;
}

export async function sendMessage(gameId, senderId, content, channel = 'public') {
  const { error } = await supabase.from('messages')
    .insert({ game_id: gameId, sender_id: senderId, content, channel });
  if (error) throw error;
}

export async function getMessages(gameId) {
  const { data, error } = await supabase
    .from('messages')
    .select('*, profiles:sender_id(username, avatar)')
    .eq('game_id', gameId)
    .order('created_at');
  if (error) throw error;
  return data;
}

// ============================================================
// REALTIME SUBSCRIPTIONS
// ============================================================

export function subscribeRoom(roomId, callback) {
  return supabase.channel(`room:${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, callback)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, callback)
    .subscribe();
}

export function subscribeGame(gameId, callback) {
  return supabase.channel(`game:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, callback)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` }, callback)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'votes', filter: `game_id=eq.${gameId}` }, callback)
    .subscribe();
}

export function subscribeMessages(gameId, callback) {
  return supabase.channel(`messages:${gameId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `game_id=eq.${gameId}` }, callback)
    .subscribe();
}

// ============================================================
// UTILS
// ============================================================

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length: 5}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function defaultSettings() {
  return {
    mafia_count: 2,
    has_doctor: true, has_sheriff: true, has_bodyguard: false,
    has_mayor: false, has_medium: false, has_jester: false,
    has_sk: false, has_executioner: false, has_witch: false,
    has_framer: false, has_consigliere: false,
    day_duration: 120, night_duration: 45, vote_duration: 30
  };
}

// Expose globally for non-module scripts
window.Mafia = {
  supabase, signUp, signIn, signOut, getUser, getProfile, requireAuth,
  createRoom, joinRoom, getRoomByCode, leaveRoom, setReady,
  getGameState, submitNightAction, submitVote, sendMessage, getMessages,
  subscribeRoom, subscribeGame, subscribeMessages
};
