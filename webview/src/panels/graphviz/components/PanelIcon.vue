<script setup lang="ts">
defineProps<{ name: string; size?: number }>()
const paths: Record<string, string> = {
    memory: 'M6 6h12v12H6z M9 9h6v6H9z M9 3v3 M15 3v3 M9 18v3 M15 18v3 M3 9h3 M3 15h3 M18 9h3 M18 15h3',
    loop: 'M18 4l3 3-3 3 M21 7H7a4 4 0 0 0-4 4 M6 20l-3-3 3-3 M3 17h14a4 4 0 0 0 4-4',
    chevron: 'M9 5l7 7-7 7',
    follow: 'M4 7h14l-3-3 M20 17H6l3 3 M18 7l-3 3 M6 17l3-3',
    pin: 'M9 3h6l-1 7 4 4H6l4-4z M12 14v7',
    graph: 'M5 4h4v4H5z M15 16h4v4h-4z M5 16h4v4H5z M7 8v4h10v4 M7 12v4',
    text: 'M4 5h16 M8 5v14 M4 19h8 M15 11h5 M15 15h5 M15 19h5',
    refresh: 'M20 7v5h-5 M4 17v-5h5 M6.1 7a7 7 0 0 1 11.6-2L20 8 M4 16l2.3 3A7 7 0 0 0 18 17',
    copy: 'M9 9h11v11H9z M15 5V3H3v12h2',
    open: 'M14 3h7v7 M21 3l-11 11 M10 3H3v18h18v-7',
    settings: 'M4 7h7 M15 7h5 M4 17h3 M11 17h9 M11 4v6 M7 14v6',
    fit: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M3 16v5h5 M8 8h8v8H8z',
    plus: 'M12 5v14 M5 12h14',
    minus: 'M5 12h14',
    close: 'M6 6l12 12 M18 6L6 18',
    check: 'M5 12l4 4L19 6',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    file: 'M14 2H5v20h14V7z M14 2v5h5 M8 12h8 M8 16h6'
}
</script>
<template>
    <svg :width="size || 16" :height="size || 16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.file" /></svg>
</template>
