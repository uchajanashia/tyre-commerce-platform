import { Season } from '@core/models';

export interface SeasonChoice {
  readonly id: Season;
  readonly index: string;
  readonly label: string;
  readonly caption: string;
  readonly temperature: string;
  readonly surface: string;
  readonly character: string;
}

export const SEASON_CHOICES: readonly SeasonChoice[] = [
  {
    id: 'all-season',
    index: '01',
    label: $localize`ყველა სეზონი`,
    caption: $localize`ქალაქი და ცვალებადი ამინდი`,
    temperature: '−5°C — +25°C',
    surface: $localize`შერეული`,
    character: $localize`ბალანსი`,
  },
  {
    id: 'summer',
    index: '02',
    label: $localize`ზაფხული`,
    caption: $localize`თბილი და მშრალი გზა`,
    temperature: '+7°C და მეტი',
    surface: $localize`მშრალი / სველი`,
    character: $localize`მაქსიმალური გრიპი`,
  },
  {
    id: 'winter',
    index: '03',
    label: $localize`ზამთარი`,
    caption: $localize`ცივი გზა, ტალახი და თოვლი`,
    temperature: '+7°C-ზე ნაკლები',
    surface: $localize`ცივი / თოვლიანი`,
    character: $localize`კონტროლი`,
  },
] as const;
