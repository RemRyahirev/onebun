import DefaultTheme from 'vitepress/theme';
import BenchmarkResults from '../components/BenchmarkResults.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('BenchmarkResults', BenchmarkResults);
  },
};
