# M15 地图 dump（seed=ember-01，字符 = 土地利用 zone）
# C 商业中心 R 居民区 s 城郊 I 工业园 M 军事 f 农田 F 林地 r 废墟 ~ 水域
# 大写字母出现在地图上 = 那一带是连片的（扎堆），而不是散点

## 余烬市区（r5-6，tier 1，主题 city）扎堆指数 0.65（随机基准 0.15，打散后 0.15 → 连片度 4.5x）
    012345678901234567890123
  0 ss~ssssssssrrrr~FfffffFf
  1 sssssssssssrrrr~rrrrrrrr
  2 sssss~sssssrrrr~rrrrrrrr
  3 IiiFF~~~~~ssrrrrrrrrrrrr
  4 iIIFF~~~~~~ssrrssrR~~~fr
  5 IFFFFrr~~S~rssssrrr~~rfr
  6 FFFFFrrr~S~rRrrrrrrrrrFF
  7 FFFFFrrr~~~rRrrrrsssssFF
  8 FFsssrrrrrrRRrrrsssssFFF
  9 FFrrssrrrrrRRr~~~sssFFFF
 10 F~rRRsrrrrRCCCCCCsssFFFF
 11 ~~RRRRrrrrCCCCCCCCssFFFF
 12 RRRRRRCCCCCCHCCRR~~sFFFF
 13 FRRRRRC~~CC~.CRRRR..RFFF
 14 F~~RRRCCCCC~~CRRRRR~RRLF
 15 F~~~RRRCCCCCCCCRRRRRRRRR
 16 FF~~RRRRRCCCCCCRRRRRRRRR
 17 FFFrrRRRRRR~~MMMMRRRRRRR
 18 FFrrrrRRRR~~MMMMMRRRRRRR
 19 FrrrrrrRRR~~MMMMMM~RRRRR
 20 ffff~rrrRRRRRMMMMM~iIRRR
 21 ff~~~ffffRRRRMMMMMMMiIRR
 22 f~~~~ffffRRRRRRMMFFFFIIi
 23 f~~ffffffRRRRRRMMFFFFiii
统计 residential:158 ruins:82 forest:77 water:70 suburb:67 cbd:46 military:31 farmland:24 industry:18 open:3 · POI 105 个 · 地表 suburb:65 water:70 ruins:78 highway:53 forest:75 industrial:18 city:166 farm:24 military:27

## 北农场带（r6-0，tier 5，主题 farm）扎堆指数 0.67（随机基准 0.27，打散后 0.25 → 连片度 2.6x）
    012345678901234567890123
  0 ffffffffffffffffffffrrrr
  1 fffffffrrrrfffffffffrrrF
  2 fffffffrr~rrffLfffffrrrF
  3 fffffff~~~MMMfff~~~~~rrF
  4 ~fffff~~~~MMMff~~~SS~~rF
  5 ~fffff~~MMMMMff~~~~~~rrf
  6 ~fffffrrMMMMMff~~~~~rrfF
  7 ffffffrrrMMMMfff~~~frrFf
  8 ffffffrrrrMMMfffffffrrfF
  9 fffffffrrr~.MMfsssfffrrF
 10 fffffffrrrr.sssssffffrr~
 11 f~~ffffrrrr~.~ffffffff~~
 12 f~~~fffrrrr~H~fffffff~~~
 13 ff~~fff~~cc.~fffffff~~~f
 14 rrffffffcccCcFFFffff~~ff
 15 rrfffffffCCCCFFFffffffff
 16 rrf~fffffCcCcFFFfffffFff
 17 rrf~fffffrrCFFFFffffFFFF
 18 rrfssfffffrrFFFF~~fffFFF
 19 rrssrrrfffrrrFFf~~ffffff
 20 rssrrrr~~~~~rfff~~~fff~f
 21 rssrrrr~~~~~~fff~~ffff~~
 22 r~ssrrr~ii~~~f~~~fffffff
 23 r~sssrrriffff~~~ffffffff
统计 farmland:266 water:102 ruins:81 forest:39 military:25 suburb:22 residential:17 cbd:16 industry:4 open:4 · POI 73 个 · 地表 farm:237 highway:57 ruins:76 forest:36 water:102 industrial:4 military:17 suburb:21 city:26

## 北西岭（r1-0，tier 5，主题 forest）扎堆指数 0.65（随机基准 0.18，打散后 0.16 → 连片度 4.2x）
    012345678901234567890123
  0 ffFffrrrrrrrrffffr~S~~~F
  1 Fffffrrrrrr~~ffffr~~~~~F
  2 ~~FFFFrrrss~~ffffr~rFF~F
  3 ~~~FFFFFFsss~ffffrrrFFFF
  4 ~F~~FFFFFssssffffrrrFFFF
  5 FF~~FFFrsRrssMMMMMrrFFFF
  6 FFFFFFrrsssrsMMMMMrrFFFF
  7 FFFFFFrr~~ssr~MMMMrI~~~I
  8 FFFFFFrrrrrrr~MMMFriI~ii
  9 FFFFFFrrrrrrrMMMMFFIiILI
 10 FFFFFFrrrrrrccCccFFFIIii
 11 F~~FFrrrrrrFFcCCCFFFFFiI
 12 F~~~rrrrrrrFHCCCCrFFF~~I
 13 F~S~r~~~rrrFFCCccrrF~~~~
 14 ~~~~~~~~rrrrcc~~crrF~~~~
 15 ~~~rr~~sFssss~~~rrrFFFFr
 16 FFrrrrffsrRss~~rrrFFFFFr
 17 FFrrrfffssss~~rrFFFFFFFr
 18 FFrrrffffsss~~~ssss~~Frr
 19 FFrrrffffsssf~~sss~~~rrr
 20 FFrrrfffffffffssss~~~rrr
 21 FFrrrffffffffffs~~~~~rrr
 22 FFrrrrfffffffff~~~f~~~rr
 23 FFrrr~~fffffffffffff~~rr
统计 forest:142 ruins:139 water:106 farmland:76 suburb:49 military:21 cbd:20 industry:18 residential:5 · POI 87 个 · 地表 forest:132 ruins:130 farm:68 highway:48 water:106 suburb:48 city:15 military:16 industrial:13

## 北化工园（r3-0，tier 5，主题 industrial）扎堆指数 0.64（随机基准 0.15，打散后 0.13 → 连片度 4.9x）
    012345678901234567890123
  0 ffffffFffff~~~~~~Ffffiii
  1 rrrfffffFff~S~~~iIFFiL~~
  2 rrrrfFFFFff~~~~IIFFFIiii
  3 rrrrFFFFFFff~~iIiFFFIiir
  4 ~~~rRrFFFFFfiIIImmMMMrrr
  5 ~S~~~rrRRFFrII~~MMMMMRrr
  6 ~~~~~rrrRrrrri~~MMMMMrrr
  7 FFF~~rrrrRRrriMMMMMM~~~r
  8 FFFFFF~~rrrrrMMMMMMMM~~R
  9 FFFFF~~~iiiiIisssssssssr
 10 FFFF~~~~iIiIiissssssssrr
 11 rFFF~~~FFFFi~.RRrr~ssrrr
 12 rrrrI~~~FFF~H.rRrr~rsrrr
 13 rIiIII~~~II~~cRRrrrRsffr
 14 IIIIIIIIIIIIICFFRRRRsfff
 15 ~~IIIIIIrRccCCFFFRRssfff
 16 ~IIIIIIRRRRRRCFFFFsssf~f
 17 rrFFFIIFRRRRRrrFFFFF~~~~
 18 FFFFFFFFRRRRrrrrrFF~~~~~
 19 FFFFFFFFRRRRrrrrrr~~~fff
 20 FFFFFFFFIRRRrrrrrr~~ffff
 21 FFFFFFFFIII~~rrrrrffffff
 22 FFFFFFFFFIIIIrrrrrff~fff
 23 FFFFF~~FFIIIIrrrrfff~~~f
统计 forest:131 water:93 industry:87 residential:85 ruins:63 farmland:51 military:29 suburb:28 cbd:7 open:2 · POI 109 个 · 地表 farm:48 forest:126 water:93 industrial:69 ruins:57 highway:58 city:83 military:19 suburb:23

## 北东水库（r11-0，tier 5，主题 water）扎堆指数 0.61（随机基准 0.17，打散后 0.15 → 连片度 4.2x）
    012345678901234567890123
  0 rfffffffrrrrrr~~rrrrr~rr
  1 ffffffffrrrrrr~~irrrr~rr
  2 ffff~~ffrmMrrMM~irrrrrrr
  3 ffff~~~~~~~MMMMiIrrrrrrr
  4 fffffffr~~~MMMIifffffff~
  5 ~~ffffrrf~~.MMIifFffff~~
  6 ~~fffrrFFFMMMMIiFFFFff~~
  7 ~fffrrFFFFFFr~IiFFFiIIII
  8 rrrrrFFFFFFFR~~FFFFFiiIi
  9 rrrr~~~~~FFRR~~~FF~~iiii
 10 rrrr~~~~~~FrCcC~~~~~~iIF
 11 rrrF~~~~~~FRFcCc~~~~FiFF
 12 rFFFFFFFFrFFHCCC...RFFLF
 13 FFFFFFFFFrrFFCC~~sRRFFFF
 14 F~~FFFFFFrrrrC~~~sRRFFFF
 15 ~~~~FFFFrrrrr~~~ssRrrR~F
 16 FFFFFF~~~rrrcc~fssrrrr~~
 17 FFFFFF~~~~~rcffffsrrrr~~
 18 rrrrr~~~~~~ccffffsrrrR~s
 19 rrrr~~~RR~~ccffff~~~~~~s
 20 rff~~~rrrr~rfffff~~~SS~~
 21 fff~~rrRrr~rrrrffff~~~~F
 22 ffffrFrrrr~rrrrrrfff~~FF
 23 ffffRFrrrR~~rrrrffffffFF
统计 water:135 ruins:108 forest:108 farmland:97 residential:48 industry:29 cbd:19 military:17 suburb:11 open:4 · POI 99 个 · 地表 ruins:101 forest:90 farm:93 water:135 industrial:25 military:14 highway:57 city:51 suburb:10

## 北西营地（r0-0，tier 5，主题 military）扎堆指数 0.64（随机基准 0.18，打散后 0.17 → 连片度 3.7x）
    012345678901234567890123
  0 ff~~ffffFfFrrrrrrrrr~~~r
  1 f~~~ffffFfFrrrrrrrrrr~~r
  2 ~~S~~fffffffrrrrrrrrrrrr
  3 r~~~~fffffff~~rrrffffrrr
  4 rr~~fffffff~~~ffffffffff
  5 rrrrrrFFrrr~~~~fffffffff
  6 rrrrrFFFFrrr~~~fffffffff
  7 rrrrrFFFFrrrr~~ffffff~ff
  8 rrrrriIiirrrrfffFFffff~~
  9 rrrrssssiirrrffFFFFMMMf~
 10 rrrssrRrrIirffffFFFMMMf~
 11 rrssRRRr~~~ffffffFMMMMff
 12 rrs~rR~~~cc.HffffMMMM~~f
 13 frss~~~.CCC~.cffffMM~~ff
 14 frrsR..~CCCCCCffffff~~ff
 15 fLrsr~CccFcCccFFFrrrrrrr
 16 ffrsrrccFFCCcCFFFFrrrr~r
 17 ffrsrRCFFFFFFFFFFFrrr~~~
 18 f~rssrrFFFFFFFFFFrr~~~~~
 19 f~rsssFFFFFFFFFFFr~~~FF~
 20 ffrssFFFFF~~FFFFFr~~FFFF
 21 fffFFFFFFF~~rFFFFFFFFFFF
 22 f~~FFFFFFF~~rrrrFFFFFFFF
 23 f~~FF~~FFF~~rrrrrrFFFFFF
统计 forest:130 farmland:128 ruins:125 water:90 cbd:26 residential:24 suburb:23 military:16 industry:9 open:5 · POI 81 个 · 地表 farm:113 water:90 forest:126 highway:50 ruins:115 industrial:9 suburb:21 military:15 city:37
