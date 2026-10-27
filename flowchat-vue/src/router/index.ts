import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: { template: '<div></div>' } }, // 空组件占位
    { path: '/chat/:id', component: { template: '<div></div>' } },
  ],
})

export default router