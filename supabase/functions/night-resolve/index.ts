// Edge Function: night-resolve
// ينفذ أحداث الليل بالترتيب الصحيح:
// Witch → Mafia/SK kills → Bodyguard intercept → Doctor save → Sheriff investigate

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { game_id } = await req.json();
    if (!game_id) throw new Error('game_id required');

    // Get game
    const { data: game } = await supabase.from('games').select('*').eq('id', game_id).single();
    if (!game || game.phase !== 'night') throw new Error('Not night phase');

    const nightNum = game.day_number;

    // Get all night actions
    const { data: actions } = await supabase
      .from('night_actions')
      .select('*')
      .eq('game_id', game_id)
      .eq('night_num', nightNum);

    // Get all alive players with roles
    const { data: players } = await supabase
      .from('game_players')
      .select('*')
      .eq('game_id', game_id)
      .eq('is_alive', true);

    const playerMap = new Map(players!.map(p => [p.player_id, p]));
    const actionMap = new Map(actions!.map(a => [a.action_type + ':' + a.player_id, a]));

    // Helper
    const getAction = (type: string) => actions!.find(a => a.action_type === type);
    const getPlayerByRole = (role: string) => players!.find(p => p.role === role);

    const deaths: string[] = [];
    const saves: string[] = [];
    const results: Record<string, any> = {};

    // ── 1. WITCH: redirect a kill ──────────────────────────
    const witchAction = getAction('redirect');
    let witchRedirect: { from: string; to: string } | null = null;
    if (witchAction?.target_id) {
      // Witch redirects the mafia kill to a different target
      // witchAction.target_id = new target
      witchRedirect = { from: 'mafia_kill', to: witchAction.target_id };
    }

    // ── 2. MAFIA KILL ──────────────────────────────────────
    let mafiaTarget = getAction('kill')?.target_id;
    if (witchRedirect && mafiaTarget) {
      mafiaTarget = witchRedirect.to;
    }

    // ── 3. SK KILL ─────────────────────────────────────────
    let skTarget = getAction('sk_kill')?.target_id;
    // SK has 50% doctor immunity
    const skSavedByDoc = skTarget && Math.random() < 0.5 ? true : false;

    // ── 4. BODYGUARD ───────────────────────────────────────
    const guardAction = getAction('guard');
    const guardedPlayer = guardAction?.target_id;
    let bodyguardDied = false;

    if (guardedPlayer && mafiaTarget === guardedPlayer) {
      // Bodyguard intercepts mafia kill
      bodyguardDied = true;
      // Kill the attacker (mafioso or godfather)
      const mafiosoPlayer = players!.find(p => p.role === 'mafioso') || players!.find(p => p.role === 'godfather');
      if (mafiosoPlayer) {
        deaths.push(mafiosoPlayer.player_id);
        results['bodyguard_intercept'] = { killed: mafiosoPlayer.player_id, saved: guardedPlayer };
      }
      mafiaTarget = null; // Kill was blocked
      // Bodyguard also dies
      const bgPlayer = players!.find(p => p.role === 'bodyguard');
      if (bgPlayer) deaths.push(bgPlayer.player_id);
    }

    // ── 5. DOCTOR SAVE ────────────────────────────────────
    const saveAction = getAction('save');
    const savedPlayer = saveAction?.target_id;

    if (mafiaTarget && mafiaTarget !== savedPlayer) {
      deaths.push(mafiaTarget);
    } else if (mafiaTarget && mafiaTarget === savedPlayer) {
      saves.push(savedPlayer);
      results['doctor_save'] = savedPlayer;
    }

    if (skTarget && !skSavedByDoc && skTarget !== savedPlayer) {
      if (!deaths.includes(skTarget)) deaths.push(skTarget);
    }

    // ── 6. FRAMER ─────────────────────────────────────────
    const frameAction = getAction('frame');
    if (frameAction?.target_id) {
      await supabase.from('game_players')
        .update({ is_framed: true })
        .eq('game_id', game_id)
        .eq('player_id', frameAction.target_id);
    }
    // Reset previous frames
    if (!frameAction) {
      await supabase.from('game_players')
        .update({ is_framed: false })
        .eq('game_id', game_id)
        .eq('team', 'town');
    }

    // ── 7. SHERIFF INVESTIGATE ───────────────────────────
    const investigateAction = getAction('investigate');
    if (investigateAction?.target_id) {
      const target = playerMap.get(investigateAction.target_id);
      if (target) {
        const isMafia = target.team === 'mafia' || target.is_framed;
        const isGodfather = target.role === 'godfather'; // appears innocent
        results['sheriff_result'] = {
          target_id: investigateAction.target_id,
          result: (!isGodfather && isMafia) ? 'suspicious' : 'innocent',
          for_player: investigateAction.player_id
        };
      }
    }

    // ── 8. CONSIGLIERE ───────────────────────────────────
    const scoutAction = getAction('scout');
    if (scoutAction?.target_id) {
      const target = playerMap.get(scoutAction.target_id);
      if (target) {
        results['consigliere_result'] = {
          target_id: scoutAction.target_id,
          role: target.role,
          for_player: scoutAction.player_id
        };
      }
    }

    // ── Apply deaths ─────────────────────────────────────
    const uniqueDeaths = [...new Set(deaths)];
    for (const pid of uniqueDeaths) {
      await supabase.from('game_players')
        .update({ is_alive: false, death_phase: 'night', death_day: game.day_number })
        .eq('game_id', game_id).eq('player_id', pid);
    }

    // ── Advance to day ───────────────────────────────────
    const { data: settings } = await supabase
      .from('rooms').select('settings')
      .eq('id', game.room_id).single();
    const dayDuration = settings?.settings?.day_duration || 120;
    const phaseEndsAt = new Date(Date.now() + dayDuration * 1000).toISOString();

    await supabase.from('games').update({
      phase: 'day',
      day_number: game.day_number + 1,
      phase_ends_at: phaseEndsAt
    }).eq('id', game_id);

    // System message
    let announcement = '';
    if (uniqueDeaths.length === 0) {
      announcement = '🌅 أشرقت الشمس... لم يُقتل أحد الليلة!';
    } else {
      announcement = `🌅 أشرقت الشمس... قُتل ${uniqueDeaths.length} لاعب الليلة.`;
    }

    await supabase.from('messages').insert({
      game_id, sender_id: (await supabase.from('game_players').select('player_id').eq('game_id', game_id).limit(1).single()).data!.player_id,
      content: announcement, channel: 'system'
    });

    // Check win condition
    await checkWinCondition(supabase, game_id);

    return new Response(JSON.stringify({
      success: true, deaths: uniqueDeaths, saves, results
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});

async function checkWinCondition(supabase: any, gameId: string) {
  const { data: alivePlayers } = await supabase
    .from('game_players').select('*').eq('game_id', gameId).eq('is_alive', true);

  const total = alivePlayers!.length;
  const mafia = alivePlayers!.filter((p: any) => p.team === 'mafia').length;
  const town  = alivePlayers!.filter((p: any) => p.team === 'town').length;
  const sk    = alivePlayers!.filter((p: any) => p.role === 'sk').length;

  let winner = null;

  if (mafia === 0 && sk === 0) winner = 'town';
  else if (mafia >= town + sk) winner = 'mafia';
  else if (total <= 2 && sk > 0) winner = 'sk';

  if (winner) {
    await supabase.from('games').update({
      phase: 'ended', winner_team: winner, ended_at: new Date().toISOString()
    }).eq('id', gameId);

    // Update player stats
    const { data: allPlayers } = await supabase
      .from('game_players').select('player_id, team, role').eq('game_id', gameId);

    for (const p of allPlayers!) {
      const won = p.team === winner || p.role === winner;
      await supabase.from('profiles').update({
        games_played: supabase.rpc('increment', { x: 1 }),
        wins: won ? supabase.rpc('increment', { x: 1 }) : undefined,
        losses: !won ? supabase.rpc('increment', { x: 1 }) : undefined,
        gems: won ? supabase.rpc('increment', { x: 100 }) : supabase.rpc('increment', { x: 20 }),
        xp: won ? supabase.rpc('increment', { x: 200 }) : supabase.rpc('increment', { x: 50 })
      }).eq('id', p.player_id);
    }
  }
}
