import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";

export interface ApexChartImplProps {
  type: "line" | "bar" | "rangeBar";
  series: ApexOptions["series"];
  options: ApexOptions;
  height: number;
}

/**
 * The only module that imports ApexCharts. Loaded with React.lazy (`LazyChart`), so the chart
 * library is a separate chunk fetched when the first chart is shown.
 */
export default function ApexChartImpl({ type, series, options, height }: ApexChartImplProps) {
  return <ReactApexChart type={type} series={series} options={options} height={height} width="100%" />;
}
