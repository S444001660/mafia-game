// Edge Function: vote-resolve
// يُحسب التصويت ويُقصي اللاعب الأكثر أصواتاً

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

    const { data: game } = await supabase
      .from('games').select('*').eq('id', game_id).single();
    if (!game || game.phase !== 'voting') throw new Error('Not voting phase');

    const dayNum = game.day_number;

    // Get all votes
    const { data: votes } = await supabase
      .from('votes').select('*').eq('game_id', game_id).eq('day_num', dayNum);

    // Get alive players (mayor gets double vote)
    const { data: players } = await supabase
      .from('game_players').select('*').eq('game_id', game_id).eq('is_alive', true);

    // Count votes with mayor weight
    const voteCounts = new Map<string, number>();
    for (const vote of votes!) {
      if (!vote.target_id) continue;
      const voter = players!.find(p => p.player_id === vote.voter_id);
      const weight = voter?.role === 'mayor' ? 2 : 1;
      voteCounts.set(vote.target_id, (voteCounts.get(vote.target_id) || 0) + weight);
    }

    // Find max votes
    let maxVotes = 0;
    let eliminated: string | null = null;
    let isTie = false;

    for (const [pid, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        eliminated = pid;
        isTie = false;
      } else if (count === maxVotes) {
        isTie = true;
        eliminated = null;
      }
    }

    let result = { eliminated: null as string | null, role: null as string | null, team: null as string | null };

    if (eliminated && !isTie) {
      // Eliminate player
      const eliminatedPlayer = players!.find(p => p.player_id === eliminated);
      await supabase.from('game_players').update({
        is_alive: false, death_phase: 'vote', death_day: dayNum
      }).eq('game_id', game_id).eq('player_id', eliminated);

      result = {
        eliminated,
        role: eliminatedPlayer?.role,
        team: eliminatedPlayer?.team
      };

      // Check if jester wins (was voted out)
      if (eliminatedPlayer?.role === 'jester') {
        await supabase.from('games').update({
          phase: 'ended', winner_team: 'jester', ended_at: new Date().toISOString()
        }).eq('id', game_id);

        await supabase.from('messages').insert({
          game_id, sender_id: eliminated,
          content: `🃏 أُقصي المهرج! فاز المهرج! ${eliminatedPlayer.player_id}`,
          channel: 'system'
        });

        return new Response(JSON.stringify({ ...result, winner: 'jester' }), {
          headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }

      // Check if executioner target was eliminated
      const { data: executor } = await supabase
        .from('game_players')
        .select('*').eq('game_id', game_id)
        .eq('role', 'executioner').eq('is_alive', true).single();

      if (executor && executor.executioner_target === eliminated) {
        await supabase.from('games').update({
          phase: 'ended', winner_team: 'executioner', ended_at: new Date().toISOString()
        }).eq('id', game_id);
      }

      const roleNames: Record<string, string> = {
        godfather:'العراب', mafioso:'المنفذ', framer:'المزور', consigliere:'المتسلل',
        doctor:'الطبيب', sheriff:'المحقق', bodyguard:'الحارس', mayor:'العمدة',
        medium:'المشعوذ', citizen:'مواطن', jester:'المهرج', sk:'القاتل', executioner:'المنتقم', witch:'الساحرة'
      };

      await supabase.from('messages').insert({
        game_id, sender_id: eliminated,
        content: `🗳️ أُقصي لاعب — كان دوره: ${roleNames[eliminatedPlayer?.role] || eliminatedPlayer?.role}`,
        channel: 'system'
      });
    } else {
      // Tie — no elimination
      await supabase.from('messages').insert({
        game_id,
        sender_id: (await supabase.from('game_players').select('player_id').eq('game_id', game_id).limit(1).single()).data!.player_id,
        content: '⚖️ تعادل في التصويت — لم يُقصَ أحد!',
        channel: 'system'
      });
    }

    // Advance to night
    const { data: roomData } = await supabase
      .from('rooms').select('settings').eq('id', game.room_id).single();
    const nightDuration = roomData?.settings?.night_duration || 45;
    const phaseEndsAt = new Date(Date.now() + nightDuration * 1000).toISOString();

    await supabase.from('games').update({
      phase: 'night', phase_ends_at: phaseEndsAt
    }).eq('id', game_id);

    // Check win condition
    const { data: alivePlayers } = await supabase
      .from('game_players').select('*').eq('game_id', game_id).eq('is_alive', true);

    const mafia = alivePlayers!.filter((p: any) => p.team === 'mafia').length;
    const townAndNeutral = alivePlayers!.filter((p: any) => p.team !== 'mafia').length;
    const sk = alivePlayers!.filter((p: any) => p.role === 'sk').length;

    let winner = null;
    if (mafia === 0 && sk === 0) winner = 'town';
    else if (mafia >= townAndNeutral) winner = 'mafia';

    if (winner) {
      await supabase.from('games').update({
        phase: 'ended', winner_team: winner, ended_at: new Date().toISOString()
      }).eq('id', game_id);
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
