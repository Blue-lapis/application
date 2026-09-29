// にとよんツールのリポジトリの直下にコピーし、npx vite-node runner.ts cases.json out.json で実行する。
// tests/compare-nitoyon.mjs が書いた条件を、にとよんツールの計算（PokemonStrength）で1件ずつ計算する。
import { readFileSync, writeFileSync } from "node:fs";
import { AlwaysTap, NoTap } from "./src/util/Energy";
import Nature, { type NatureType } from "./src/util/Nature";
import PokemonIv from "./src/util/PokemonIv";
import PokemonStrength from "./src/util/PokemonStrength";
import { createStrengthParameter } from "./src/util/StrengthParameter";
import SubSkill, { type SubSkillType } from "./src/util/SubSkill";
import SubSkillList from "./src/util/SubSkillList";

type Case = {
	name: string;
	level: number;
	ing: string;
	subs: SubSkillType[];
	nature: NatureType;
	e4eEnergy: number;
	e4eCount: number;
	full: boolean;
	tap: number; // 分、1 = 常にタップ、0 = 受け取らない
	camp: boolean;
	helpBonusCount: 0 | 1;
};

const cases: Case[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const lvKeys = ["lv10", "lv25", "lv50", "lv70", "lv80"] as const;
const out = cases.map((c) => {
	const subs: Record<string, SubSkill> = {};
	c.subs.forEach((s, i) => {
		subs[lvKeys[i]] = new SubSkill(s);
	});
	const iv = new PokemonIv({
		pokemonName: c.name,
		level: c.level,
		ingredient: c.ing as never,
		subSkills: new SubSkillList(subs),
		nature: new Nature(c.nature),
	});
	const param = createStrengthParameter({
		e4eEnergy: c.e4eEnergy,
		e4eCount: c.e4eCount,
		isEnergyAlwaysFull: c.full,
		tapFrequencyAwake: c.tap === 1 ? AlwaysTap : c.tap,
		tapFrequencyAsleep: NoTap,
		isGoodCampTicketSet: c.camp,
		helpBonusCount: c.helpBonusCount,
		addHelpingBonusEffect: false,
		sleepScore: 100,
	});
	const r = new PokemonStrength(iv, param).calculate();
	// 食材は A・B・C の順（ing1・ing2・ing3）に、1日の個数を返す。
	const names = [iv.pokemon.ing1.name, iv.pokemon.ing2.name, iv.pokemon.ing3?.name];
	return {
		ing: names.map((nm) =>
			r.ingredients
				.filter((x) => x.name === nm)
				.reduce((a, x) => a + x.count, 0),
		),
		skill: r.skillCount,
		berry: r.berryTotalStrength,
	};
});
writeFileSync(process.argv[3], JSON.stringify(out));
