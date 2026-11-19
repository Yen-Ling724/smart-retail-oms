// 系統模組清單：側邊欄和總覽頁共用
export const modules = [
  { number: '01', title: '商品管理', detail: '集中整理商品型號、規格、價格與替代關係。', status: '可使用', href: '#products' },
  { number: '02', title: '門市庫存', detail: '20 間門市（取自官網門市據點）的可售、展示、瑕疵、在途，以及進貨、盤點與調貨。', status: '可使用', href: '#inventory' },
  { number: '03', title: '訂單管理', detail: '購物車建立多商品訂單，預留門市庫存並追蹤出貨，防止超賣。', status: '可使用', href: '#orders' },
  { number: '04', title: '智慧導購', detail: '一句話描述需求，依預算、坪數、人數與實際庫存推薦商品並說明理由。', status: '可使用', href: '#assistant' },
  { number: '05', title: '3D 坪數選購', detail: '依房間坪數與條件，用 3D 房間看冷氣、清淨機、除濕機能否涵蓋整間；查門市庫存、送出報價與場勘預約。', status: '可使用', href: '/room-fit.html?view=staff', external: true },
]
