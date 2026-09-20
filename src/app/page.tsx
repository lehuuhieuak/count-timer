export default function HomePage() {
  return (
    <div className="app-shell">
      <header>
        <div className="brand">Count Timer</div>
        <div className="tabs" role="tablist" aria-label="Chế độ đồng hồ">
          <button type="button" role="tab" aria-selected="true">Đếm lên</button>
          <button type="button" role="tab" aria-selected="false">Đếm ngược</button>
        </div>
      </header>
      <main aria-label="Count Timer" />
    </div>
  );
}
