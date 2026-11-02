export interface Review {
  market_view?: string; mood?: string; text?: string; risks?: string[]; this_month_plan?: string[];
  buy?: { symbol: string; name: string; why: string; entry_range: string; target: string; stop_loss: string; amount: number; horizon: string }[];
  holdings?: { symbol: string; action: string; why: string; sell_or_add_trigger: string; price_checked: number | null }[];
}

