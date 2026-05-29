/**
 * 배지 조건 체크 및 수여
 * 세션 완료 시 호출 → 새로 획득된 배지 반환
 */

type SupabaseClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (...args: any[]) => any;
};

export interface BadgeAwarded {
  badge_id: string;
  name: string;
  icon: string;
}

export async function checkAndAwardBadges(
  supabase: SupabaseClient,
  userId: string,
  streak: number,
  totalWordCount: number,
): Promise<BadgeAwarded[]> {
  try {
    const [badgesRes, earnedRes] = await Promise.allSettled([
      supabase.from('badges').select('badge_id, name, icon, threshold_type, threshold_value, category_filter'),
      supabase.from('user_badges').select('badge_id').eq('user_id', userId),
    ]);

    if (badgesRes.status !== 'fulfilled' || earnedRes.status !== 'fulfilled') return [];

    const allBadges = badgesRes.value.data ?? [];
    const earnedIds = new Set((earnedRes.value.data ?? []).map((b: { badge_id: string }) => b.badge_id));

    // category_count 배지의 카테고리별 학습 단어 수를 일괄 조회
    const categoryCountBadges = allBadges.filter(
      (b: { threshold_type: string; badge_id: string; category_filter: string | null }) =>
        !earnedIds.has(b.badge_id) && b.threshold_type === 'category_count' && b.category_filter,
    );
    const uniqueCategories = [
      ...new Set(categoryCountBadges.map((b: { category_filter: string }) => b.category_filter)),
    ] as string[];
    const categoryCountMap: Record<string, number> = {};
    for (const cat of uniqueCategories) {
      const { data: catWords } = await supabase
        .from('words')
        .select('word_id')
        .eq('category', cat);
      const catWordIds = (catWords ?? []).map((w: { word_id: string }) => w.word_id);
      if (catWordIds.length === 0) { categoryCountMap[cat] = 0; continue; }
      const { count } = await supabase
        .from('user_word_state')
        .select('word_id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('word_id', catWordIds);
      categoryCountMap[cat] = count ?? 0;
    }

    const newBadges: BadgeAwarded[] = [];

    for (const badge of allBadges) {
      if (earnedIds.has(badge.badge_id)) continue;

      let qualified = false;
      if (badge.threshold_type === 'word_count') {
        qualified = totalWordCount >= badge.threshold_value;
      } else if (badge.threshold_type === 'streak') {
        qualified = streak >= badge.threshold_value;
      } else if (badge.threshold_type === 'category_count' && badge.category_filter) {
        qualified = (categoryCountMap[badge.category_filter] ?? 0) >= badge.threshold_value;
      }

      if (!qualified) continue;

      const { error } = await supabase
        .from('user_badges')
        .insert({ user_id: userId, badge_id: badge.badge_id });

      if (!error) {
        newBadges.push({ badge_id: badge.badge_id, name: badge.name, icon: badge.icon });
        console.log(JSON.stringify({ event: 'badge_awarded', userId, badge_id: badge.badge_id }));
      }
    }

    return newBadges;
  } catch (e) {
    console.warn(JSON.stringify({ event: 'check_badges_failed', error: (e as Error)?.message }));
    return [];
  }
}
